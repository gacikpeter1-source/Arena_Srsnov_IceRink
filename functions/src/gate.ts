// The read/consume half of the ESP32 turnstile-gate signal — see
// src/lib/gate.ts's own doc comment for the write half (QrScanPage.tsx
// writes gateTriggers/{clubId} right after a successful entrance scan).
// Deliberately a plain public onRequest, not an onCall: the ESP32 has no
// way to carry a Firebase Auth ID token, and there's nothing sensitive to
// protect here — the real "is this ticket valid" check already happened
// before the write this endpoint is reading.
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

/**
 * Polled by the ESP32 (every ~1s, see hardware/esp32-turnstile-gate's own
 * firmware) as `GET /gateStatus?clubId=<id>`. Returns the plain text body
 * "1" exactly once per real trigger (the first poll to see a fresh,
 * not-yet-consumed `openedAt` atomically flips `consumed` to true inside
 * the same transaction, so a second poll a second later — or a dropped-
 * then-retried response — never re-opens the gate for the same scan) and
 * "0" otherwise. Plain text rather than JSON on purpose: keeps the
 * firmware dependency-free (no JSON parsing library needed on the device).
 */
export const gateStatus = onRequest(async (req, res) => {
  const clubId = req.query.clubId;
  if (typeof clubId !== "string" || !clubId) {
    res.status(400).send("0");
    return;
  }

  const db = getFirestore();
  const ref = db.doc(`gateTriggers/${clubId}`);

  let shouldOpen = false;
  try {
    shouldOpen = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const data = snap.data() as { openedAt?: Timestamp; consumed?: boolean };
      if (!data.openedAt || data.consumed) return false;
      tx.update(ref, { consumed: true });
      return true;
    });
  } catch (err) {
    logger.error("gateStatus: failed to read/consume trigger", err);
  }

  res.set("Cache-Control", "no-store");
  res.status(200).send(shouldOpen ? "1" : "0");
});

// Each ticket's own QR (see RegistrationTicket, src/types/index.ts) encodes
// the exact same cancel-link URL QrScanPage.tsx already recognizes, plus a
// `?ticket=<id>` param — see that page's own handleScan for the reference
// implementation this mirrors. Bundle registrations are deliberately NOT
// supported here: a bundle covers many real sessions, and QrScanPage.tsx
// itself can only resolve "which one" automatically when exactly one of
// them falls on today's date — with no human to ask otherwise, an
// unattended scan has no way to break that tie, so a bundle link always
// returns "0" and stays a staff-assisted (phone) check-in only.
const SESSION_CANCEL_PATH = /^\/treningy\/zrusit\/([^/]+)\/([^/]+)$/;

/**
 * Polled-into by the ESP32's GM65 barcode/QR module (see
 * hardware/esp32-turnstile-gate) as `GET /gateScanCheckIn?data=<urlencoded
 * scanned text>&clubId=<id>` — the GM65 hands the ESP32 the raw decoded
 * string from a customer's own ticket QR (the same URL their confirmation
 * PDF/email already embeds), and the ESP32 forwards it here verbatim
 * rather than trying to validate anything itself. Per explicit product
 * direction, this is now the PRIMARY entrance path (the GM65 at the
 * turnstile), with QrScanPage.tsx's phone-camera flow kept only as a
 * manual fallback if the turnstile hardware fails — "group" QR codes
 * (one code covering several people) are not allowed here at all; every
 * real ticket is its own person, its own code, checked in exactly once.
 *
 * Unlike gateStatus above (a dumb poll of an already-decided trigger),
 * this function does the REAL validation itself, Admin-SDK side, since
 * there is no browser/human here to have done it first: token match,
 * registration status, and — inside one transaction, so two near-
 * simultaneous scans of the same ticket can't both win — that this
 * specific ticket hasn't already been used. Returns the same plain "1"/
 * "0" convention as gateStatus (no JSON parsing needed on the device).
 */
export const gateScanCheckIn = onRequest(async (req, res) => {
  const clubId = req.query.clubId;
  const raw = req.query.data;
  res.set("Cache-Control", "no-store");
  if (typeof clubId !== "string" || !clubId || typeof raw !== "string" || !raw) {
    res.status(200).send("0");
    return;
  }

  let pathname: string;
  let ticketId: string | null;
  try {
    const parsed = new URL(raw);
    pathname = parsed.pathname;
    ticketId = parsed.searchParams.get("ticket");
  } catch {
    res.status(200).send("0");
    return;
  }

  const match = pathname.match(SESSION_CANCEL_PATH);
  if (!match || !ticketId) {
    // No match at all (garbage scan, or a bundle/ice-booking link — both
    // unsupported here), or a match with no ?ticket= param (an older,
    // pre-per-ticket QR, or a registration predating this field) — either
    // way, this automated path has no safe way to check in "the whole
    // registration" unattended, so it's always a deny, never a fallback
    // to whole-group check-in the way the staff phone flow still allows.
    res.status(200).send("0");
    return;
  }
  const [, regId, token] = match;

  const db = getFirestore();
  const regRef = db.doc(`trainingRegistrations/${regId}`);

  let shouldOpen = false;
  try {
    shouldOpen = await db.runTransaction(async (tx) => {
      const snap = await tx.get(regRef);
      if (!snap.exists) return false;
      const reg = snap.data() as {
        clubId?: string;
        cancellationToken?: string;
        status?: string;
        tickets?: { id: string; label: string }[];
        ticketCheckIns?: Record<string, { checkedIn?: boolean }>;
        attendance?: { checkedIn?: boolean };
      };
      if (reg.clubId !== clubId || reg.cancellationToken !== token) return false;
      // Deliberately stricter than QrScanPage.tsx's own human-supervised
      // flow (which still lets staff mark a pending/waitlisted entry
      // present at their own judgment) — with no one there to judge, only
      // a fully 'confirmed' registration may open the gate on its own.
      if (reg.status !== "confirmed") return false;
      const ticket = reg.tickets?.find((t) => t.id === ticketId);
      if (!ticket) return false;
      if (reg.ticketCheckIns?.[ticketId]?.checkedIn === true) return false;

      tx.update(regRef, {
        [`ticketCheckIns.${ticketId}`]: { checkedIn: true, checkedInAt: Timestamp.now(), checkedInBy: "gate-scanner" },
        ...(reg.attendance?.checkedIn ? {} : { attendance: { checkedIn: true, checkedInAt: Timestamp.now(), checkedInBy: "gate-scanner" } })
      });
      return true;
    });
  } catch (err) {
    logger.error("gateScanCheckIn: failed to validate/check in ticket", err);
  }

  res.status(200).send(shouldOpen ? "1" : "0");
});
