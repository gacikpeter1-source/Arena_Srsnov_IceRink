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
