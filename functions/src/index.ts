// Sends the emails the app queues by writing to the `mail` collection
// (see src/lib/email.ts) — this REPLACES the "Trigger Email from
// Firestore" extension, which hit a Google Deployment Manager bug on
// install for this project. Same document shape the extension expects
// ({ to, message: { subject, html } }), so no client-side code changes
// were needed to switch.
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import * as nodemailer from "nodemailer";
import * as XLSX from "xlsx";
import { getGameGenerator } from "./cognitiveGames/registry";
import { buildPlanFromTasks, totalPlanDurationMs } from "./cognitiveGames/engine";

initializeApp();

// Set with:
//   firebase functions:secrets:set SMTP_URI
//   firebase functions:secrets:set MAIL_FROM
// SMTP_URI example: smtps://user%40gmail.com:app-password@smtp.gmail.com:465
// (Gmail requires an App Password, not your regular password, since
// Google retired "less secure app" access.)
const smtpUri = defineSecret("SMTP_URI");
const mailFrom = defineSecret("MAIL_FROM");

export const sendQueuedMail = onDocumentCreated(
  { document: "mail/{mailId}", secrets: [smtpUri, mailFrom] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data() as {
      to?: string;
      message?: { subject?: string; html?: string };
      attachments?: { filename: string; content: string; contentType: string }[];
      delivery?: unknown;
    };

    // Firestore triggers can occasionally fire more than once for the
    // same event — skip if we've already processed this doc.
    if (data.delivery) return;

    const { to, message } = data;
    if (!to || !message?.subject || !message?.html) {
      logger.warn("mail doc missing to/message.subject/message.html", {
        id: event.params.mailId,
      });
      await snap.ref.update({
        delivery: { state: "ERROR", error: "Missing to/subject/html" },
      });
      return;
    }

    const transporter = nodemailer.createTransport(smtpUri.value());

    try {
      await transporter.sendMail({
        from: mailFrom.value(),
        to,
        subject: message.subject,
        html: message.html,
        attachments: data.attachments,
      });
      await snap.ref.update({
        delivery: { state: "SUCCESS", endTime: new Date().toISOString() },
      });
      logger.info("Email sent", { to, subject: message.subject });
    } catch (err) {
      await snap.ref.update({
        delivery: { state: "ERROR", error: String(err) },
      });
      logger.error("Failed to send email", err);
    }
  }
);

// Deletes a staff account for real (Firestore doc + Firebase Auth user)
// instead of just revoking their role back to 'pending' — the Auth half
// can't be done from the client SDK for anyone but yourself, so this
// needs the Admin SDK. firestore.rules can't express this action at all
// (it's not a plain doc write), so the permission checks below re-derive
// the same restrictions the /staff update rule already enforces for role
// changes: a superadmin can remove anyone, an owner can remove anyone
// except an owner/superadmin row, nobody can remove themselves.
export const deleteStaffAccount = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  const targetUid = request.data?.uid;
  if (typeof targetUid !== "string" || !targetUid) {
    throw new HttpsError("invalid-argument", "Missing target uid.");
  }
  if (targetUid === callerUid) {
    throw new HttpsError("failed-precondition", "Cannot delete your own account.");
  }

  const db = getFirestore();
  const callerSnap = await db.doc(`staff/${callerUid}`).get();
  const callerRole = callerSnap.data()?.role;
  if (callerRole !== "superadmin" && callerRole !== "owner") {
    throw new HttpsError("permission-denied", "Only owners or superadmins can delete staff accounts.");
  }

  const targetRef = db.doc(`staff/${targetUid}`);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new HttpsError("not-found", "Staff account not found.");
  }
  const targetRole = targetSnap.data()?.role;
  if (callerRole === "owner" && (targetRole === "owner" || targetRole === "superadmin")) {
    throw new HttpsError("permission-denied", "Owners cannot delete an owner or superadmin account.");
  }

  await targetRef.delete();
  try {
    await getAuth().deleteUser(targetUid);
  } catch (err) {
    // The Firestore doc (the actual access-control record) is already
    // gone; a missing/already-deleted Auth user at this point isn't fatal.
    logger.warn("Auth user delete failed after staff doc delete", { targetUid, err: String(err) });
  }
});

// ---------------------------------------------------------------------
// Cognitive training ("Kognitívny tréning") — see src/types/index.ts for
// the full data-model rationale. Two callables:
// ---------------------------------------------------------------------

// A plain onCall (not a raw onRequest endpoint) purely so the client can
// reuse the exact same already-initialized Functions SDK/httpsCallable
// pattern every other Cloud Function call in this app already uses (see
// deleteStaffAccountCallable in lib/staff.ts) — callable functions work
// fine for an unauthenticated caller (the TV has no login; request.auth
// is simply unused here), so a one-off raw-HTTP endpoint wasn't needed
// just for this. The client calls this several times in a row (see
// measureClockOffsetMs in lib/cognitiveTraining/clockSync.ts) and keeps
// whichever round trip had the lowest latency, NTP-style.
export const cognitiveServerTime = onCall(() => {
  return { now: Date.now() };
});

// Chosen once, server-side, specifically so it's never out of sync with
// the identical constant in src/lib/cognitiveTraining/phase.ts (functions/
// is a separate TypeScript project from src/ and can't import across that
// boundary — same "ported copy" precedent as zonedTimeToUtc elsewhere in
// this file). Keep both in sync if this ever changes.
const COGNITIVE_COUNTDOWN_MS = 3000;
const COGNITIVE_DEFAULT_PAUSE_SECONDS = 5;

// Generates a session's whole exercise plan up front — the one piece of
// this feature that MUST run server-side rather than on the trainer's own
// device, since the plan's correct answers have to end up in a document
// only the owning trainer/staff can read back (cognitiveSessionAnswers),
// which the client itself can never be trusted to split correctly on its
// own. Requires the caller to actually be the session's own trainer (not
// just "a trainer") — re-derived here rather than trusted from the client,
// since the Admin SDK write below bypasses firestore.rules entirely, same
// reasoning deleteStaffAccount already documents.
export const startCognitiveSession = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  const sessionId = request.data?.sessionId;
  if (typeof sessionId !== "string" || !sessionId) {
    throw new HttpsError("invalid-argument", "Missing sessionId.");
  }

  const db = getFirestore();
  const staffSnap = await db.doc(`staff/${callerUid}`).get();
  const staffData = staffSnap.data();
  const isOwnerOrSuperadmin = staffData?.role === "owner" || staffData?.role === "superadmin";
  if (staffData?.isTrainer !== true && !isOwnerOrSuperadmin) {
    throw new HttpsError("permission-denied", "Only a trainer (or owner/superadmin) can start a cognitive training session.");
  }

  const sessionRef = db.doc(`cognitiveSessions/${sessionId}`);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new HttpsError("not-found", "Session not found.");
  }
  const session = sessionSnap.data() as { trainerId?: string; status?: string; gameId?: string; config?: Record<string, unknown> };
  if (session.trainerId !== callerUid) {
    throw new HttpsError("permission-denied", "Not your session.");
  }
  if (session.status !== "draft") {
    throw new HttpsError("failed-precondition", "Session already started.");
  }

  const generator = getGameGenerator(session.gameId ?? "");
  if (!generator) {
    throw new HttpsError("invalid-argument", `Unknown gameId: ${session.gameId}`);
  }

  const config = session.config ?? {};
  const pauseDurationMs = (Number(config.pauseDurationSeconds) || COGNITIVE_DEFAULT_PAUSE_SECONDS) * 1000;
  const tasks = generator.generate(config, Math.random);
  const { phases, answers } = buildPlanFromTasks(tasks, pauseDurationMs);
  const totalDurationMs = totalPlanDurationMs(phases);
  const startAtMs = Date.now() + COGNITIVE_COUNTDOWN_MS;

  const batch = db.batch();
  batch.update(sessionRef, {
    status: "started",
    phases,
    startAt: Timestamp.fromMillis(startAtMs),
    totalDurationMs
  });
  batch.set(db.doc(`cognitiveSessionAnswers/${sessionId}`), {
    trainerId: callerUid,
    answers
  });
  await batch.commit();

  return { startAtMs, phases, totalDurationMs };
});

// Permanently deletes finished rink-schedule bookings (see CLAUDE.md's
// "Rink team schedule" > "Fáza 3: cleanup" note) — an explicit, scoped
// exception to this app's usual soft-cancel/keep-history stance: a club
// operator asked for old rink-schedule occurrences to be hard-deleted
// once they're a couple hours old ("nepotrebuje tieto dáta"), unlike ice
// bookings made directly by a customer, training sessions, or tournament
// matches, none of which this job touches. Runs every 30 minutes so a
// finished occurrence disappears reasonably close to, not long after, the
// grace window below.
const RINK_SCHEDULE_CLEANUP_DELAY_HOURS = 2;
const CLEANUP_BATCH_LIMIT = 400; // Firestore batches cap at 500 writes.

function bookingEndMillis(booking: Record<string, unknown>): number | null {
  const startAtUtc = booking.startAtUtc as Timestamp | undefined;
  const durationMinutes = booking.durationMinutes as number | undefined;
  if (!startAtUtc || typeof durationMinutes !== "number") return null;
  return startAtUtc.toMillis() + durationMinutes * 60_000;
}

export const cleanupFinishedRinkScheduleEntries = onSchedule("every 30 minutes", async () => {
  const db = getFirestore();
  const cutoff = Date.now() - RINK_SCHEDULE_CLEANUP_DELAY_HOURS * 60 * 60 * 1000;

  const entriesSnap = await db.collection("rinkScheduleEntries").get();

  let batch = db.batch();
  let opsInBatch = 0;
  let deletedBookings = 0;
  let deletedEntries = 0;

  const queueDelete = async (ref: FirebaseFirestore.DocumentReference) => {
    batch.delete(ref);
    opsInBatch++;
    if (opsInBatch >= CLEANUP_BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  };

  for (const entryDoc of entriesSnap.docs) {
    const entry = entryDoc.data();

    // A repeatForever entry (see RinkScheduleEntry's own doc comment in
    // src/types/index.ts) is deliberately NOT covered by this 2-hour
    // delete — topUpForeverRinkScheduleEntries below keeps creating new
    // occurrences indefinitely, so "every occurrence gone" never
    // naturally happens here, and the entry doc should never be deleted
    // except by an explicit "Zmazať celú sériu". Its old occurrence
    // Bookings still get cleaned up eventually, just by the much longer
    // 60-day cleanupOldBookings job instead (matching what staff were
    // actually told to expect for this mode: data stays ~2 months, not
    // 2 hours).
    if (entry.repeatForever === true) continue;

    if (typeof entry.bookingId === "string") {
      // Single, non-recurring entry — one real Booking doc to check.
      const bookingRef = db.doc(`bookings/${entry.bookingId}`);
      const bookingSnap = await bookingRef.get();
      const endMillis = bookingSnap.exists ? bookingEndMillis(bookingSnap.data()!) : null;
      // A missing booking (already gone some other way) or one that's
      // aged past the cutoff both mean this entry has nothing left worth
      // keeping — delete the booking (if it's still there) and the entry
      // together.
      if (!bookingSnap.exists || (endMillis !== null && endMillis <= cutoff)) {
        if (bookingSnap.exists) {
          await queueDelete(bookingRef);
          deletedBookings++;
        }
        await queueDelete(entryDoc.ref);
        deletedEntries++;
      }
      continue;
    }

    if (typeof entry.seriesId === "string") {
      // Recurring entry — every occurrence is its own Booking doc sharing
      // this seriesId (createBookingSeries books them all up front, no
      // "generate more later" job exists), so each ages out on its own.
      const occurrencesSnap = await db
        .collection("bookings")
        .where("seriesId", "==", entry.seriesId)
        .get();

      let remaining = 0;
      for (const occDoc of occurrencesSnap.docs) {
        const endMillis = bookingEndMillis(occDoc.data());
        if (endMillis !== null && endMillis <= cutoff) {
          await queueDelete(occDoc.ref);
          deletedBookings++;
        } else {
          remaining++;
        }
      }
      // Every occurrence this series ever had is now gone (or none ever
      // existed) — nothing left for the entry doc to point at.
      if (remaining === 0) {
        await queueDelete(entryDoc.ref);
        deletedEntries++;
      }
      continue;
    }
    // An entry with neither field set shouldn't exist — not this job's
    // problem to fix, so it's left alone rather than guessed at.
  }

  if (opsInBatch > 0) {
    await batch.commit();
  }

  logger.info("Rink schedule cleanup finished", { deletedBookings, deletedEntries });
});

// Keeps a weekly-repeating FreeIceSlot series (see FreeIceSlot.repeatWeekly
// in src/types/index.ts) alive indefinitely without either running dry or
// growing without bound: rather than generating a long list of future
// occurrences up front, a series is always exactly FREE_ICE_SERIES_TARGET
// docs — once one's date has passed, this job "rolls" that same doc
// forward to a new date one interval past the series' own latest
// occurrence (reusing the id, not delete-and-recreate), so the series
// permanently holds a fixed, small number of documents. src/lib/
// freeIceSlots.ts's startFreeIceSlotRepeat only ever creates the initial
// window; this job is what actually sustains it week over week. A series
// whose owner clicked "Zrušiť opakovanie" (cancelFreeIceSlotRepeat)
// disappears from this job's query entirely, since that call always clears
// `repeatWeekly` on every occurrence it touches.
const FREE_ICE_SERIES_TARGET_OCCURRENCES = 4; // keep in sync with src/lib/freeIceSlots.ts
const FREE_ICE_SERIES_INTERVAL_DAYS = 7;

function localDateString(timeZone: string, date: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD directly — avoids the UTC-vs-local "today"
  // bug documented on formatDateISO in src/lib/utils.ts, here on the
  // server side where there's no device-local Date to read from at all.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// Shared by every job below that needs "this club's IANA timezone" while
// scanning across many clubs' docs at once (rollFreeIceSlotSeries,
// cleanupOldFreeIceSlots) — a fresh cache per call, same as each of those
// jobs used to keep inline before being factored out here.
function makeTimezoneLookup(db: FirebaseFirestore.Firestore): (clubId: string) => Promise<string> {
  const cache = new Map<string, string>();
  return async (clubId: string): Promise<string> => {
    const cached = cache.get(clubId);
    if (cached) return cached;
    const clubSnap = await db.doc(`clubs/${clubId}`).get();
    const tz = (clubSnap.data()?.timezone as string | undefined) ?? "Europe/Bratislava";
    cache.set(clubId, tz);
    return tz;
  };
}

// Ported from src/lib/ics.ts's zonedTimeToUtc — same self-contained,
// Intl-only DST-aware local-to-UTC conversion, duplicated here rather than
// imported since functions/ is a separate TypeScript project from src/.
function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(new Date(guess))
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    parts.hour === "24" ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const offsetMillis = asIfUtc - guess;
  return new Date(guess - offsetMillis);
}

export const rollFreeIceSlotSeries = onSchedule("every 24 hours", async () => {
  const db = getFirestore();

  const slotsSnap = await db.collection("freeIceSlots").where("repeatWeekly", "==", true).get();
  if (slotsSnap.empty) {
    logger.info("Free ice slot series roll: nothing to do");
    return;
  }

  const bySeries = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  for (const d of slotsSnap.docs) {
    const seriesId = d.data().seriesId as string | undefined;
    if (!seriesId) continue; // shouldn't happen — repeatWeekly always comes with a seriesId
    if (!bySeries.has(seriesId)) bySeries.set(seriesId, []);
    bySeries.get(seriesId)!.push(d);
  }

  const timezoneFor = makeTimezoneLookup(db);

  let batch = db.batch();
  let opsInBatch = 0;
  let rolledCount = 0;
  const commitIfNeeded = async () => {
    if (opsInBatch >= CLEANUP_BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  };

  for (const docs of bySeries.values()) {
    const clubId = docs[0].data().clubId as string;
    const today = localDateString(await timezoneFor(clubId));

    const sorted = [...docs].sort((a, b) => (a.data().date as string).localeCompare(b.data().date as string));
    let latestDate = sorted[sorted.length - 1].data().date as string;
    let futureCount = sorted.filter((d) => (d.data().date as string) >= today).length;

    for (const d of sorted) {
      const date = d.data().date as string;
      if (date >= today) continue;
      // Enough future occurrences already exist — a stray past doc this
      // job somehow hasn't rolled yet (e.g. a missed run) is left as-is
      // rather than rolled past the target count.
      if (futureCount >= FREE_ICE_SERIES_TARGET_OCCURRENCES) continue;
      latestDate = addDaysToDateString(latestDate, FREE_ICE_SERIES_INTERVAL_DAYS);
      batch.update(d.ref, { date: latestDate });
      opsInBatch++;
      futureCount++;
      rolledCount++;
      await commitIfNeeded();
    }
  }

  if (opsInBatch > 0) {
    await batch.commit();
  }

  logger.info("Free ice slot series roll finished", { rolledCount, seriesCount: bySeries.size });
});

// Sustains a repeatForever RinkScheduleEntry's rolling window of real
// future occurrences (see RinkScheduleEntry.repeatForever's own doc
// comment in src/types/index.ts) — createRinkScheduleEntry only ever
// creates the INITIAL RINK_SCHEDULE_FOREVER_WINDOW occurrences; this job
// is what keeps topping it back up to that count, forever, as old ones
// age past. Mirrors rollFreeIceSlotSeries's "fixed-size rolling window"
// shape above, but can't reuse its mechanism: a FreeIceSlot is just
// advertising copy (rolling its `date` field in place is risk-free),
// while a RinkScheduleEntry occurrence is a REAL ice reservation — a new
// one has to go through the exact same atomic check-and-reserve
// transaction createBooking's client-side version uses, just
// reimplemented here with the Admin SDK (functions/ is a separate
// TypeScript project from src/, same reason zonedTimeToUtc above is a
// ported standalone copy rather than an import).
const RINK_SCHEDULE_FOREVER_WINDOW = 8; // keep in sync with src/lib/rinkSchedule.ts

// Exact ports of src/lib/utils.ts's own generateToken/generateConfirmationCode
// — real Web Crypto (available globally in the Node 20 runtime, no import
// needed), not Math.random(), for the same reason this app's own training-
// domain rewrite rejected a Math.random() cancellationToken as not
// cryptographically secure (see CLAUDE.md's "Training reservations" section).
function generateToken(length = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let token = "";
  for (let i = 0; i < length; i++) {
    token += chars[bytes[i] % chars.length];
  }
  return token;
}

function generateConfirmationCode(): string {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  const part1 = (bytes[0] % 1000).toString().padStart(3, "0");
  const part2 = (bytes[1] % 1000).toString().padStart(3, "0");
  return `${part1}-${part2}`;
}

// Admin-SDK port of createBooking's transaction (src/lib/bookings.ts) —
// same atomic check-reclaim-reserve shape, just using Timestamp.now()
// in place of serverTimestamp() and returning a plain boolean (false =
// slot unavailable) instead of throwing a client-only SlotUnavailableError,
// so the caller's retry loop below can stay a plain while-loop.
async function createBookingAdmin(
  db: FirebaseFirestore.Firestore,
  input: {
    clubId: string;
    rinkId: string;
    zoneId: string;
    date: string;
    startTime: string;
    durationMinutes: number;
    name: string;
    email: string;
    phone: string;
    timezone: string;
    seriesId: string;
  }
): Promise<boolean> {
  const lockRef = db.doc(`slotLocks/${input.clubId}__${input.zoneId}__${input.date}__${input.startTime}`);
  const bookingRef = db.collection("bookings").doc();
  try {
    await db.runTransaction(async (tx) => {
      const lockSnap = await tx.get(lockRef);
      if (lockSnap.exists) {
        const expiresAt = lockSnap.data()?.expiresAt as Timestamp | undefined;
        if (!expiresAt || expiresAt.toMillis() >= Date.now()) {
          throw new Error("SLOT_UNAVAILABLE");
        }
      }
      const confirmationCode = generateConfirmationCode();
      const cancellationToken = generateToken();
      const tokenExpiresAt = Timestamp.fromMillis(Date.now() + 14 * 24 * 60 * 60 * 1000);

      tx.set(lockRef, {
        clubId: input.clubId,
        zoneId: input.zoneId,
        date: input.date,
        startTime: input.startTime,
        bookingId: bookingRef.id,
        createdAt: Timestamp.now(),
      });

      tx.set(bookingRef, {
        clubId: input.clubId,
        rinkId: input.rinkId,
        zoneId: input.zoneId,
        date: input.date,
        startTime: input.startTime,
        durationMinutes: input.durationMinutes,
        name: input.name,
        email: input.email,
        phone: input.phone,
        seriesId: input.seriesId,
        confirmationCode,
        cancellationToken,
        tokenExpiresAt,
        startAtUtc: Timestamp.fromDate(zonedTimeToUtc(input.date, input.startTime, input.timezone)),
        status: "confirmed",
        createdAt: Timestamp.now(),
      });
    });
    return true;
  } catch (err) {
    if (err instanceof Error && err.message === "SLOT_UNAVAILABLE") return false;
    throw err;
  }
}

export const topUpForeverRinkScheduleEntries = onSchedule("every 24 hours", async () => {
  const db = getFirestore();
  const entriesSnap = await db.collection("rinkScheduleEntries").where("repeatForever", "==", true).get();
  if (entriesSnap.empty) {
    logger.info("Forever rink-schedule top-up: nothing to do");
    return;
  }

  const timezoneFor = makeTimezoneLookup(db);
  let createdTotal = 0;

  for (const entryDoc of entriesSnap.docs) {
    const entry = entryDoc.data();
    const seriesId = entry.seriesId as string | undefined;
    if (!seriesId) continue;
    const frequency = entry.frequency === "daily" ? "daily" : "weekly";
    const stepDays = frequency === "daily" ? 1 : 7;

    const occSnap = await db.collection("bookings").where("seriesId", "==", seriesId).get();
    const occurrences = occSnap.docs.map((d) => d.data());
    if (occurrences.length === 0) {
      // Shouldn't normally happen (creation always makes at least the
      // first occurrence) — nothing to clone email/phone/dates from, so
      // left alone rather than guessed at, same stance this app already
      // takes for other "shouldn't exist" edge cases.
      logger.warn("repeatForever entry has no occurrences to top up from, skipping", { entryId: entryDoc.id });
      continue;
    }

    const activeDates = occurrences
      .filter((b) => b.status !== "cancelled" && b.status !== "expired")
      .map((b) => b.date as string);
    const latestDate = occurrences.map((b) => b.date as string).reduce((a, b) => (a > b ? a : b));

    const timezone = await timezoneFor(entry.clubId as string);
    const today = localDateString(timezone);
    // Counts only ACTIVE (non-cancelled) future occurrences — cancelling
    // one via "Zrušiť tento termín" genuinely frees up a slot in the
    // window, so the next run backfills a new one further out to restore
    // the full count, matching "maximálne 8 udalostí naplánované" literally
    // (8 planned events, not 8 dates reserved regardless of cancellation).
    const futureActiveCount = activeDates.filter((d) => d >= today).length;
    const needed = RINK_SCHEDULE_FOREVER_WINDOW - futureActiveCount;
    if (needed <= 0) continue;

    // Reuse an existing occurrence's own synthesized email/phone —
    // RinkScheduleEntry never stores these itself (see
    // createRinkScheduleEntry's own doc comment: there's no real customer
    // to email here, startRinkScheduleEntryRepeat already reuses the same
    // fields this same way for its own, differently-triggered top-up).
    const sample = occurrences[occurrences.length - 1];

    let cursor = latestDate;
    let createdForThisEntry = 0;
    let attempts = 0;
    // Capped so a persistently-blocked window (e.g. every candidate date
    // collides with something else) can't loop indefinitely in one run.
    while (createdForThisEntry < needed && attempts < needed * 4 + 8) {
      cursor = addDaysToDateString(cursor, stepDays);
      attempts++;
      const ok = await createBookingAdmin(db, {
        clubId: entry.clubId as string,
        rinkId: entry.rinkId as string,
        zoneId: entry.zoneId as string,
        date: cursor,
        startTime: entry.startTime as string,
        durationMinutes: entry.durationMinutes as number,
        name: entry.teamName as string,
        email: sample.email as string,
        phone: (sample.phone as string | undefined) ?? "",
        timezone,
        seriesId,
      });
      if (ok) {
        createdForThisEntry++;
        createdTotal++;
      }
    }
  }

  logger.info("Forever rink-schedule top-up finished", { createdTotal });
});

// Permanently deletes any Booking doc — regardless of which domain created
// it (a direct customer /book reservation, a rink-schedule-tool entry, or a
// tournament match's blocksIce reservation) — once it's this many days past
// its own end time. A rink-schedule-sourced booking is normally already long
// gone well before this (cleanupFinishedRinkScheduleEntries above deletes
// those within RINK_SCHEDULE_CLEANUP_DELAY_HOURS — except a repeatForever
// entry's occurrences, deliberately excluded from that job so they get this
// job's much longer 2-month-ish window instead, see that job's own skip
// comment), so in practice this job mostly catches direct customer bookings
// and tournament blocksIce bookings, neither of which had ANY cleanup before
// this — they accumulated forever.
// 60 days is deliberately generous: it's what gives
// sendMonthlyRinkUtilizationReport below a safe margin to still find last
// month's data even if that job runs a few days late, while still bounding
// how long raw booking data (name/email/phone) sits around. A deleted
// booking's id can be left dangling on a TournamentMatch/RinkScheduleEntry
// doc that still references it — same "orphaned docs left in place,
// harmless" precedent this app already accepts elsewhere (old
// divisionRules docs, a stale occurrenceRooms key) — neither ever reads the
// Booking back once its own data (score, team names) lives on itself. A
// booking missing startAtUtc (predates that field) is left alone rather than
// guessed at, same documented gap the cancellation-cutoff feature already
// accepts for that field. Shared with cleanupOldFreeIceSlots below — both
// collections get the same 60-day window for the same reason (a safe
// margin for the monthly report).
const DATA_RETENTION_DAYS = 60;

export const cleanupOldBookings = onSchedule("every 24 hours", async () => {
  const db = getFirestore();
  const cutoffMillis = Date.now() - DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const snap = await db
    .collection("bookings")
    .where("startAtUtc", "<=", Timestamp.fromMillis(cutoffMillis))
    .get();

  let batch = db.batch();
  let opsInBatch = 0;
  let deletedCount = 0;

  for (const docSnap of snap.docs) {
    const endMillis = bookingEndMillis(docSnap.data());
    if (endMillis === null || endMillis > cutoffMillis) continue;
    batch.delete(docSnap.ref);
    opsInBatch++;
    deletedCount++;
    if (opsInBatch >= CLEANUP_BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  if (opsInBatch > 0) {
    await batch.commit();
  }

  logger.info("Old bookings cleanup finished", { deletedCount });
});

// Same visibility-cutoff/retention treatment as cleanupOldBookings above,
// for FreeIceSlot — the admin "zoznam voľných ľadov" list
// (FreeIceSlotsPage.tsx) had no cutoff and no cleanup at all before this,
// so a one-off listing just accumulated forever. A FreeIceSlot stores its
// own explicit `endTime` (not a duration like Booking), and has no
// `startAtUtc` field to filter on server-side the way cleanupOldBookings
// does — this collection is small enough per club that a full scan plus an
// in-memory zonedTimeToUtc check per doc is fine, same approach
// cleanupFinishedRinkScheduleEntries already uses for rinkScheduleEntries.
// A repeatWeekly occurrence is rolled forward daily by rollFreeIceSlotSeries
// above and so should never actually reach this cutoff in practice, but
// nothing here special-cases it — if one somehow did go stale (e.g. its
// series was cancelled), it's just as eligible for cleanup as any one-off.
export const cleanupOldFreeIceSlots = onSchedule("every 24 hours", async () => {
  const db = getFirestore();
  const cutoffMillis = Date.now() - DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const timezoneFor = makeTimezoneLookup(db);

  const snap = await db.collection("freeIceSlots").get();

  let batch = db.batch();
  let opsInBatch = 0;
  let deletedCount = 0;

  for (const docSnap of snap.docs) {
    const slot = docSnap.data();
    const clubId = slot.clubId as string | undefined;
    const date = slot.date as string | undefined;
    const endTime = slot.endTime as string | undefined;
    if (!clubId || !date || !endTime) continue;

    const timezone = await timezoneFor(clubId);
    const endMillis = zonedTimeToUtc(date, endTime, timezone).getTime();
    if (endMillis > cutoffMillis) continue;

    batch.delete(docSnap.ref);
    opsInBatch++;
    deletedCount++;
    if (opsInBatch >= CLEANUP_BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  if (opsInBatch > 0) {
    await batch.commit();
  }

  logger.info("Old free ice slots cleanup finished", { deletedCount });
});

// Monthly "how were our rinks used" Excel report, emailed to the club's own
// contact address — see CLAUDE.md's "Monthly rink utilization report / data
// retention" section for the full rationale. Reads straight from `bookings`
// (clubId + date range), the single source of truth every real ice
// reservation already resolves to regardless of which domain created it
// (direct customer /book, a rink-schedule-tool entry, or a tournament
// match's blocksIce reservation) — trainings are never included, since that
// domain deliberately never reserves ice/zone time at all.
//
// buildMonthlyUtilizationRows is factored out on its own specifically so a
// later, more advanced view (a visual day-by-day "which hall was used when"
// timeline, explicitly requested as a future possibility, not built yet)
// can reuse the exact same row-shaping logic instead of re-deriving it —
// the only thing that view would add is its own rendering, not a new query.
function previousMonthRange(timeZone: string): { start: string; end: string; label: string } {
  const todayStr = localDateString(timeZone); // "YYYY-MM-DD", club-local "today"
  const [y, m] = todayStr.split("-").map(Number); // m is 1-based (current month)
  const prevMonthUtc = new Date(Date.UTC(y, m - 2, 1)); // month-2: previous month, 0-based
  const prevYear = prevMonthUtc.getUTCFullYear();
  const prevMonth = prevMonthUtc.getUTCMonth(); // 0-based
  const lastDay = new Date(Date.UTC(prevYear, prevMonth + 1, 0)).getUTCDate();
  const mm = String(prevMonth + 1).padStart(2, "0");
  return {
    start: `${prevYear}-${mm}-01`,
    end: `${prevYear}-${mm}-${String(lastDay).padStart(2, "0")}`,
    label: `${prevYear}-${mm}`,
  };
}

interface UtilizationRow {
  Datum: string;
  Cas: string;
  "Trvanie (min)": number;
  Hala: string;
  Zona: string;
  Nazov: string;
  Stav: string;
  Osoby: number;
}

// Rink/zone id -> display name, Slovak (translations.sk) preferred when
// set, same localizedName convention the app uses everywhere else — fixed
// to Slovak rather than reading a viewer's own language, since there's no
// viewer here, just an emailed file this club reads in their own language
// (same reasoning RinkScheduleBoardPage.tsx's own fixed-Slovak kiosk
// strings already use). Shared by both sheets of the monthly report so
// rinks/zones are only ever fetched once per club.
async function buildNameById(db: FirebaseFirestore.Firestore, clubId: string): Promise<Map<string, string>> {
  const [rinksSnap, zonesSnap] = await Promise.all([
    db.collection("rinks").where("clubId", "==", clubId).get(),
    db.collection("zones").where("clubId", "==", clubId).get(),
  ]);
  const nameById = new Map<string, string>();
  for (const d of [...rinksSnap.docs, ...zonesSnap.docs]) {
    const data = d.data();
    nameById.set(d.id, (data.translations?.sk as string | undefined) ?? (data.name as string) ?? d.id);
  }
  return nameById;
}

async function buildMonthlyUtilizationRows(
  db: FirebaseFirestore.Firestore,
  clubId: string,
  start: string,
  end: string,
  nameById: Map<string, string>
): Promise<UtilizationRow[]> {
  const bookingsSnap = await db
    .collection("bookings")
    .where("clubId", "==", clubId)
    .where("date", ">=", start)
    .where("date", "<=", end)
    .orderBy("date", "asc")
    .orderBy("startTime", "asc")
    .get();

  // actual ice use only — a never-confirmed/cancelled booking never
  // happened; filtered in-memory (not a Firestore query clause) to reuse
  // the existing clubId+date+startTime index, no new composite index needed
  return bookingsSnap.docs
    .filter((d) => d.data().status === "confirmed")
    .map((d) => {
      const b = d.data();
      return {
        Datum: b.date,
        Cas: b.startTime,
        "Trvanie (min)": b.durationMinutes,
        Hala: nameById.get(b.rinkId as string) ?? (b.rinkId as string),
        Zona: nameById.get(b.zoneId as string) ?? (b.zoneId as string),
        Nazov: b.name,
        Stav: b.status,
        Osoby: (b.attendeeCount as number | undefined) ?? 1,
      };
    });
}

interface FreeIceRow {
  Datum: string;
  Od: string;
  Do: string;
  Hala: string;
  Zona: string;
  Poznamka: string;
}

// Second sheet of the same report — every FreeIceSlot advertised for a date
// in the previous month (see "zoznam voľných ľadov", FreeIceSlotsPage.tsx).
// A FreeIceSlot isn't itself a real reservation (it's advertising copy for
// ice that was open, not necessarily booked — see FreeIceSlot in
// src/types/index.ts), so it's kept on its own sheet rather than merged into
// buildMonthlyUtilizationRows' real-bookings rows above; nameById is passed
// in rather than re-fetched since the caller already has it for the same
// clubId+date range.
async function buildMonthlyFreeIceRows(
  db: FirebaseFirestore.Firestore,
  clubId: string,
  start: string,
  end: string,
  nameById: Map<string, string>
): Promise<FreeIceRow[]> {
  const snap = await db
    .collection("freeIceSlots")
    .where("clubId", "==", clubId)
    .where("date", ">=", start)
    .where("date", "<=", end)
    .get();

  return snap.docs
    .map((d) => d.data())
    .sort((a, b) => (a.date === b.date ? (a.startTime as string).localeCompare(b.startTime) : (a.date as string).localeCompare(b.date)))
    .map((s) => ({
      Datum: s.date,
      Od: s.startTime,
      Do: s.endTime,
      Hala: nameById.get(s.rinkId as string) ?? (s.rinkId as string),
      Zona: nameById.get(s.zoneId as string) ?? (s.zoneId as string),
      Poznamka: (s.note as string | undefined) ?? "",
    }));
}

export const sendMonthlyRinkUtilizationReport = onSchedule("0 2 1 * *", async () => {
  const db = getFirestore();
  const clubsSnap = await db.collection("clubs").get();

  for (const clubDoc of clubsSnap.docs) {
    const club = clubDoc.data();
    const toEmail = club?.contact?.email as string | undefined;
    if (!toEmail) {
      logger.warn("Club has no contact email, skipping monthly report", { clubId: clubDoc.id });
      continue;
    }
    const timezone = (club?.timezone as string | undefined) ?? "Europe/Bratislava";
    const { start, end, label } = previousMonthRange(timezone);

    const nameById = await buildNameById(db, clubDoc.id);
    const rows = await buildMonthlyUtilizationRows(db, clubDoc.id, start, end, nameById);
    const freeIceRows = await buildMonthlyFreeIceRows(db, clubDoc.id, start, end, nameById);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Rezervacie");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(freeIceRows), "Volny lad");
    const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;

    await db.collection("mail").add({
      to: toEmail,
      message: {
        subject: `Mesačný výkaz využitia ľadu – ${label}`,
        html: `<p>V prílohe nájdete prehľad všetkých rezervácií ľadu za mesiac ${label} (${rows.length} záznamov) a zoznam vtedy ponúkaného voľného ľadu (${freeIceRows.length} záznamov), jeden riadok na udalosť.</p>`,
      },
      attachments: [
        {
          filename: `vytazenost-ladu-${label}.xlsx`,
          content: base64,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      ],
    });

    logger.info("Monthly rink utilization report queued", { clubId: clubDoc.id, label, rowCount: rows.length });
  }
});
