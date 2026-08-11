// Sends the emails the app queues by writing to the `mail` collection
// (see src/lib/email.ts) — this REPLACES the "Trigger Email from
// Firestore" extension, which hit a Google Deployment Manager bug on
// install for this project. Same document shape the extension expects
// ({ to, message: { subject, html } }), so no client-side code changes
// were needed to switch.
import { initializeApp } from "firebase-admin/app";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
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
