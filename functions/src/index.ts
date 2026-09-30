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
