// Sends the emails the app queues by writing to the `mail` collection
// (see src/lib/email.ts) — this REPLACES the "Trigger Email from
// Firestore" extension, which hit a Google Deployment Manager bug on
// install for this project. Same document shape the extension expects
// ({ to, message: { subject, html } }), so no client-side code changes
// were needed to switch.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
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
