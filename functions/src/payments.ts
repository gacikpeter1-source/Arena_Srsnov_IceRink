// Real-money ticket/training payments via Stripe Connect — see
// CLAUDE.md's Stripe Connect section for the account-linking half
// (stripeConnectCallback, index.ts). This module is the actual
// charge-taking half: a Checkout Session created directly on the club's
// own connected account (Direct charge — the platform's own Stripe
// balance is never touched, per this app's "I want nothing to do with
// the transactions" requirement) plus the webhook that's the only thing
// allowed to flip a registration's `payment.status` to 'paid' (Firestore
// rules have no client-writable path for that field at all — see
// src/types/index.ts's Payment comment — so this Admin-SDK write is the
// sole way it ever happens).
import * as path from "path";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import * as QRCode from "qrcode";
import * as PDFDocument from "pdfkit";

// pdfkit's built-in standard-14 fonts (Helvetica etc.) only support
// WinAnsi-range characters — Slovak diacritics like ň/š/č/ž/ľ/ť render as
// mangled glyphs (confirmed live: "Sršňov" came out as "Srš †ðv"). DejaVu
// Sans has full coverage for Slovak/Czech text, is permissively licensed,
// and ships here as a real file (not a dependency) specifically so pdfkit
// can embed it directly — `../assets/fonts` because this file compiles to
// functions/lib/payments.js, one level below functions/assets/fonts at
// runtime, matching the directory firebase deploy actually uploads (the
// whole functions/ tree is packaged, not just `lib/`).
const FONT_REGULAR = path.join(__dirname, "../assets/fonts/DejaVuSans.ttf");
const FONT_BOLD = path.join(__dirname, "../assets/fonts/DejaVuSans-Bold.ttf");

// Same platform-level Connect secret stripeConnectCallback (index.ts)
// already uses — defineSecret keys off the secret's NAME in Secret
// Manager, so redeclaring it here (this module stays self-contained,
// same reasoning cognitiveGames/ keeps its own files independent) just
// gives this file its own reference to the identical underlying value.
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");

// The Connect webhook endpoint's own signing secret (different from the
// API secret key above). One-time setup, done once on the PLATFORM'S OWN
// Stripe Dashboard (not any individual club's connected account):
//   Developers -> Webhooks -> Add endpoint
//   - Endpoint URL: this deployed stripeWebhook function's URL
//   - IMPORTANT: check "Listen to events on Connected accounts"
//   - Events: checkout.session.completed, checkout.session.async_payment_succeeded
// Then: printf '%s' '<secret>' | firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --data-file=-
// (paste the endpoint's own "Signing secret", not the API secret key) —
// use printf, NOT `echo`, when piping it in: echo appends a trailing
// newline, which becomes part of the stored secret value and makes every
// signature check fail with a confusing "no signatures found" error that
// looks like a wrong secret even though it isn't (cost real debugging
// time to track down once, see git history).
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

// Must comfortably exceed Stripe's own 30-minute floor for a Checkout
// Session's `expires_at` — see PAYMENT_PENDING_HOLD_MINUTES in
// src/lib/training.ts, which this value must stay in sync with
// (duplicated rather than shared since functions/ is a separate TS
// project from src/ and can't import across that boundary — same
// reasoning as this codebase's other ported constants, e.g.
// COGNITIVE_COUNTDOWN_MS, see CLAUDE.md).
const PAYMENT_PENDING_HOLD_MINUTES = 35;

type RegistrationKind = "session" | "bundle";

function registrationCollection(kind: RegistrationKind): string {
  return kind === "bundle" ? "trainingBundleRegistrations" : "trainingRegistrations";
}

// Matches the exact cancel-link path shape queueTrainingConfirmationEmail/
// queueBundleConfirmationEmail (src/lib/email.ts) already use — and, not
// coincidentally, the exact pattern QrScanPage.tsx already recognizes for
// entrance check-in, so a QR this function generates works there too with
// no changes needed on that side.
function cancelPath(kind: RegistrationKind, registrationId: string, token: string): string {
  return kind === "bundle" ? `/treningy/kurz/zrusit/${registrationId}/${token}` : `/treningy/zrusit/${registrationId}/${token}`;
}

type Lang = "sk" | "en";

const STRINGS: Record<
  Lang,
  {
    subject: (club: string) => string;
    greeting: (name: string) => string;
    intro: string;
    code: string;
    cancelIntro: string;
    cancelButton: string;
    pdfNote: (count: number) => string;
    ticketTitle: string;
    scanNote: string;
    adultsLabel: string;
    childrenLabel: string;
    ticketLabels: Record<"adult" | "child" | "person", string>;
    ticketOfTotal: (index: number, total: number) => string;
  }
> = {
  sk: {
    subject: (club) => `Platba prijatá – ${club}`,
    greeting: (name) => `Dobrý deň, ${name},`,
    intro: "Vaša platba bola úspešne prijatá a vaša rezervácia je potvrdená.",
    code: "Potvrdzovací kód",
    cancelIntro: "Rezerváciu môžete zrušiť tu:",
    cancelButton: "Zrušiť rezerváciu",
    pdfNote: (count) =>
      count > 1
        ? `V prílohe nájdete ${count} vstupeniek — jednu pre každú osobu, každá s vlastným QR kódom.`
        : "Vstupenka s QR kódom na vstup je priložená ako PDF súbor.",
    ticketTitle: "Vstupenka",
    scanNote: "Naskenujte tento QR kód pri vstupe.",
    adultsLabel: "Dospelí",
    childrenLabel: "Deti",
    ticketLabels: { adult: "Dospelý", child: "Dieťa", person: "Osoba" },
    ticketOfTotal: (index, total) => (total > 1 ? `Vstupenka ${index} / ${total}` : "Vstupenka")
  },
  en: {
    subject: (club) => `Payment received – ${club}`,
    greeting: (name) => `Hello ${name},`,
    intro: "Your payment was received and your booking is confirmed.",
    code: "Confirmation code",
    cancelIntro: "You can cancel your booking here:",
    cancelButton: "Cancel booking",
    pdfNote: (count) =>
      count > 1
        ? `Attached are ${count} tickets — one per person, each with its own QR code.`
        : "Your entrance ticket with the QR code is attached as a PDF.",
    ticketTitle: "Ticket",
    scanNote: "Scan this QR code at the entrance.",
    adultsLabel: "Adults",
    childrenLabel: "Children",
    ticketLabels: { adult: "Adult", child: "Child", person: "Person" },
    ticketOfTotal: (index, total) => (total > 1 ? `Ticket ${index} / ${total}` : "Ticket")
  }
};

// Builds "Dospelí: 2, Deti: 1" (or just one half, or nothing at all when
// neither count is known/zero) from a registration's adult/child split —
// shared by both the HTML email body and the PDF ticket so the two never
// disagree on wording.
function buildPeopleLine(lang: Lang, adultCount?: number, childCount?: number): string {
  const s = STRINGS[lang];
  const parts: string[] = [];
  if (adultCount) parts.push(`${s.adultsLabel}: ${adultCount}`);
  if (childCount) parts.push(`${s.childrenLabel}: ${childCount}`);
  return parts.join(", ");
}

// The QR used to be embedded inline in the HTML body as a `data:` URI
// `<img>` — several mobile mail clients (confirmed live: Gmail on iOS)
// strip or simply never render that, leaving a blank box where the QR
// should be. A real PDF attachment (buildTicketPdfBase64 below) is the
// one thing guaranteed to actually reach the customer regardless of how
// the client renders HTML email, so the QR now lives there instead, and
// the HTML body just points at it.
function buildConfirmationEmailHtml(params: { clubName: string; name: string; subtitle: string; confirmationCode: string; peopleLine: string; cancelUrl: string; lang: Lang; ticketCount: number }): string {
  const s = STRINGS[params.lang];
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
      <h2 style="margin: 0 0 16px;">${params.clubName}</h2>
      <p>${s.greeting(params.name)}</p>
      <p>${s.intro}</p>
      ${params.subtitle ? `<p style="margin: 4px 0;"><strong>${params.subtitle}</strong></p>` : ""}
      ${params.peopleLine ? `<p style="margin: 4px 0;">${params.peopleLine}</p>` : ""}
      <p style="margin: 4px 0;">${s.code}: <strong>${params.confirmationCode}</strong></p>
      <p style="margin: 16px 0; font-weight: bold;">${s.pdfNote(params.ticketCount)}</p>
      <div style="margin-top: 20px; padding: 15px; background: #f9fafb; border: 2px solid #e5e7eb; border-radius: 8px; text-align: center;">
        <p style="margin: 0 0 15px; font-size: 14px; color: #666;">${s.cancelIntro}</p>
        <a href="${params.cancelUrl}" style="display: inline-block; padding: 12px 30px; background: #dc2626; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
          ${s.cancelButton}
        </a>
      </div>
    </div>
  `;
}

/**
 * A multi-page PDF "ticket" — one page PER TICKET (one per attendeeCount —
 * see RegistrationTicket in src/types/index.ts), each with its own QR code
 * so an adult's ticket and a child's ticket on the same registration can be
 * torn apart and scanned/checked in independently at the door. Built with
 * pdfkit (pure JS, no native dependencies, fine inside a Cloud Function).
 * Returned already base64-encoded since that's the shape the `mail`
 * collection's `attachments` field already expects (see e.g.
 * sendMonthlyRinkUtilizationReport's own .xlsx attachment in index.ts).
 */
function buildTicketsPdfBase64(params: {
  clubName: string;
  name: string;
  subtitle: string;
  confirmationCode: string;
  peopleLine: string;
  tickets: { label: "adult" | "child" | "person"; qrPngBuffer: Buffer }[];
  lang: Lang;
}): Promise<string> {
  const s = STRINGS[params.lang];
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A5", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
    doc.on("error", reject);

    doc.registerFont("Regular", FONT_REGULAR);
    doc.registerFont("Bold", FONT_BOLD);

    const total = params.tickets.length;
    params.tickets.forEach((ticket, index) => {
      if (index > 0) doc.addPage();

      doc.fontSize(18).font("Bold").text(params.clubName, { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(14).font("Bold").text(s.ticketTitle, { align: "center" });
      doc.fontSize(11).font("Regular").fillColor("#666666").text(s.ticketOfTotal(index + 1, total), { align: "center" });
      doc.fillColor("#000000");
      doc.moveDown(1);

      doc.fontSize(13).font("Bold").text(s.ticketLabels[ticket.label], { align: "center" });
      doc.moveDown(0.5);

      doc.fontSize(11).font("Regular").text(params.name);
      if (params.subtitle) {
        doc.moveDown(0.3);
        doc.fontSize(13).font("Bold").text(params.subtitle);
      }
      if (params.peopleLine) {
        doc.moveDown(0.3);
        doc.fontSize(11).font("Regular").text(params.peopleLine);
      }
      doc.moveDown(0.3);
      doc.fontSize(11).font("Regular").text(`${s.code}: ${params.confirmationCode}`);
      doc.moveDown(1.5);

      const qrSize = 220;
      const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const qrX = doc.page.margins.left + (contentWidth - qrSize) / 2;
      doc.image(ticket.qrPngBuffer, qrX, doc.y, { width: qrSize, height: qrSize });
      doc.y += qrSize + 12;

      doc.fontSize(10).fillColor("#666666").text(s.scanNote, { align: "center" });
      doc.fillColor("#000000");
    });

    doc.end();
  });
}

interface CreateTicketCheckoutSessionInput {
  clubId: string;
  kind: RegistrationKind;
  registrationId: string;
  // window.location.origin from the customer's own browser at the moment
  // of registering — functions/ has no way to know a frontend's own
  // domain otherwise (each club deployment is a separate Vercel project,
  // same multi-tenant gap stripeConnectCallback's own result page already
  // works around). Threaded through the Checkout Session's success_url so
  // the webhook can recover it later without needing its own copy.
  appOrigin: string;
}

/**
 * Creates a Stripe Checkout Session for one already-created training
 * registration's own `payment` object — registerForSession/
 * registerForBundle (src/lib/training.ts) already decided the amount and
 * attached `payment: {required, amount, currency, status:'unpaid'}`
 * before this is ever called; this function only reads what's already
 * there; it never decides what to charge.
 *
 * Public/no-auth, same trust level as every other no-login customer flow
 * in this app — knowing a registration's Firestore auto-id (effectively
 * unguessable) is already the de facto "proof this is yours" this app
 * accepts elsewhere (e.g. a cancellation link).
 */
export const createTicketCheckoutSession = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const data = (request.data ?? {}) as Partial<CreateTicketCheckoutSessionInput>;
  const { clubId, kind, registrationId, appOrigin } = data;
  if (!clubId || !registrationId || !appOrigin || (kind !== "session" && kind !== "bundle")) {
    throw new HttpsError("invalid-argument", "Missing clubId/kind/registrationId/appOrigin.");
  }

  const db = getFirestore();
  const clubSnap = await db.doc(`clubs/${clubId}`).get();
  const club = clubSnap.data() as { stripeAccountId?: string; paymentsEnabled?: boolean; name?: string } | undefined;
  if (!club?.stripeAccountId) {
    throw new HttpsError("failed-precondition", "This club has no connected Stripe account.");
  }
  if (!club.paymentsEnabled) {
    throw new HttpsError("failed-precondition", "Payments are not enabled for this club.");
  }

  const regRef = db.doc(`${registrationCollection(kind)}/${registrationId}`);
  const regSnap = await regRef.get();
  const reg = regSnap.data() as { clubId?: string; payment?: { required?: boolean; amount?: number; currency?: string; status?: string } } | undefined;
  if (!reg || reg.clubId !== clubId) {
    throw new HttpsError("not-found", "Registration not found.");
  }
  if (!reg.payment?.required || reg.payment.status !== "unpaid") {
    throw new HttpsError("failed-precondition", "This registration has no unpaid payment to collect.");
  }

  const stripe = new Stripe(stripeSecretKey.value());
  const productName = kind === "bundle" ? "Kurz / tréning" : "Tréning";
  const expiresAt = Math.floor(Date.now() / 1000) + PAYMENT_PENDING_HOLD_MINUTES * 60;

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: (reg.payment.currency ?? "eur").toLowerCase(),
            product_data: { name: productName },
            unit_amount: Math.round((reg.payment.amount ?? 0) * 100)
          },
          quantity: 1
        }
      ],
      // Omitting payment_method_types on purpose: Stripe Checkout then
      // auto-offers whatever's enabled on the connected account (card is
      // on by default, plus Apple Pay/Google Pay automatically whenever
      // the customer's own browser/device supports them) — the whole
      // point of this feature, with zero extra configuration needed.
      success_url: `${appOrigin}/treningy/platba?status=success&kind=${kind}&regId=${registrationId}`,
      cancel_url: `${appOrigin}/treningy/platba?status=cancelled&kind=${kind}&regId=${registrationId}`,
      expires_at: expiresAt,
      metadata: { clubId, kind, registrationId },
      payment_intent_data: { metadata: { clubId, kind, registrationId } }
    },
    { stripeAccount: club.stripeAccountId }
  );

  if (!session.url) {
    throw new HttpsError("internal", "Stripe did not return a Checkout Session URL.");
  }

  await regRef.update({ "payment.checkoutSessionId": session.id });

  return { url: session.url };
});

/**
 * Builds and queues a session/bundle registration's real confirmation
 * email — a PDF attachment with one ticket (QR code) per
 * RegistrationTicket, the calendar invite, and the cancel link. Shared by
 * both real-money flows: the Stripe webhook below (once a payment
 * actually clears) and the public sendTrainingConfirmationEmail callable
 * (for a FREE registration, called directly by the client the moment it
 * goes 'confirmed' — see src/lib/trainingConfirmationEmail.ts). Neither
 * caller decides what this builds; this function is the one place a
 * registration's confirmation email is ever assembled, so the two flows
 * can never drift apart on content.
 */
async function sendTicketConfirmationEmail(
  db: FirebaseFirestore.Firestore,
  appOrigin: string,
  clubId: string,
  kind: RegistrationKind,
  registrationId: string
): Promise<void> {
  const regRef = db.doc(`${registrationCollection(kind)}/${registrationId}`);
  const [regSnap, clubSnap] = await Promise.all([regRef.get(), db.doc(`clubs/${clubId}`).get()]);
  const reg = regSnap.data() as
    | {
        name?: string;
        email?: string;
        confirmationCode?: string;
        cancellationToken?: string;
        language?: string;
        date?: string;
        startTime?: string;
        bundleId?: string;
        adultCount?: number;
        childCount?: number;
        tickets?: { id: string; label: "adult" | "child" | "person" }[];
        attendeeCount?: number;
      }
    | undefined;
  const club = clubSnap.data() as { name?: string } | undefined;
  if (!reg?.email || !reg.cancellationToken || !reg.confirmationCode) {
    logger.warn("sendTicketConfirmationEmail: registration missing email/token/code", { registrationId });
    return;
  }

  const lang: Lang = reg.language === "en" ? "en" : "sk";
  const clubName = club?.name ?? "";

  let subtitle = "";
  if (kind === "session" && reg.date && reg.startTime) {
    subtitle = `${reg.date} ${reg.startTime}`;
  } else if (kind === "bundle" && reg.bundleId) {
    const bundleSnap = await db.doc(`trainingBundles/${reg.bundleId}`).get();
    subtitle = (bundleSnap.data() as { title?: string } | undefined)?.title ?? "";
  }

  const cancelPathBase = cancelPath(kind, registrationId, reg.cancellationToken);
  const cancelUrl = `${appOrigin}${cancelPathBase}`;
  const peopleLine = buildPeopleLine(lang, reg.adultCount, reg.childCount);

  // One ticket (and so one QR, one PDF page) per attendeeCount — see
  // RegistrationTicket in src/types/index.ts. A registration from before
  // this field existed has no `tickets` array at all: fall back to a
  // single synthetic 'person' ticket whose QR has no `?ticket=` param, so
  // QrScanPage.tsx's own fallback (whole-registration check-in) applies.
  const tickets = reg.tickets && reg.tickets.length > 0 ? reg.tickets : [{ id: "", label: "person" as const }];

  // The QR only ever reaches the customer via the PDF attachment below
  // (see buildConfirmationEmailHtml's own doc comment for why) — if PDF
  // generation fails for any reason, the email still goes out with the
  // cancel link, just without the ticket attachment, rather than not
  // sending anything at all.
  let attachments: { filename: string; content: string; contentType: string; encoding: "base64" }[] = [];
  try {
    const ticketsWithQr = await Promise.all(
      tickets.map(async (ticket) => ({
        label: ticket.label,
        qrPngBuffer: await QRCode.toBuffer(ticket.id ? `${cancelUrl}?ticket=${ticket.id}` : cancelUrl, { width: 320, margin: 2 })
      }))
    );
    const pdfBase64 = await buildTicketsPdfBase64({
      clubName,
      name: reg.name ?? "",
      subtitle,
      confirmationCode: reg.confirmationCode,
      peopleLine,
      tickets: ticketsWithQr,
      lang
    });
    attachments = [{ filename: "vstupenky.pdf", content: pdfBase64, contentType: "application/pdf", encoding: "base64" }];
  } catch (err) {
    logger.error("Failed to build ticket PDF attachment", err);
  }

  await db.collection("mail").add({
    to: reg.email,
    message: {
      subject: STRINGS[lang].subject(clubName),
      html: buildConfirmationEmailHtml({
        clubName,
        name: reg.name ?? "",
        subtitle,
        confirmationCode: reg.confirmationCode,
        peopleLine,
        cancelUrl,
        lang,
        ticketCount: tickets.length
      })
    },
    ...(attachments.length > 0 ? { attachments } : {})
  });
}

/**
 * The Connect webhook — the only thing allowed to flip a registration's
 * `payment.status` to 'paid' (see this module's own top comment). Must
 * read the RAW request body for Stripe's signature check; Firebase
 * Functions v2's onRequest always exposes `req.rawBody` regardless of
 * whatever body-parsing also happened, so no special config is needed for
 * that part.
 */
export const stripeWebhook = onRequest({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (req, res) => {
  const sig = req.headers["stripe-signature"];
  if (typeof sig !== "string") {
    res.status(400).send("Missing stripe-signature header");
    return;
  }

  const stripe = new Stripe(stripeSecretKey.value());
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, stripeWebhookSecret.value());
  } catch (err) {
    logger.error("Stripe webhook signature verification failed", err);
    res.status(400).send("Webhook signature verification failed");
    return;
  }

  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    res.status(200).send("ignored");
    return;
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") {
    res.status(200).send("not paid yet");
    return;
  }

  const metadata = session.metadata ?? {};
  const clubId = metadata.clubId;
  const kind = metadata.kind as RegistrationKind | undefined;
  const registrationId = metadata.registrationId;
  if (!clubId || !kind || !registrationId) {
    logger.warn("Stripe webhook: checkout session missing expected metadata", { sessionId: session.id });
    res.status(200).send("missing metadata");
    return;
  }

  const db = getFirestore();
  const regRef = db.doc(`${registrationCollection(kind)}/${registrationId}`);

  const justPaid = await db.runTransaction(async (tx) => {
    const snap = await tx.get(regRef);
    if (!snap.exists) return false;
    const payment = (snap.data() as Record<string, unknown>).payment as { status?: string } | undefined;
    // Idempotency: Stripe can (and does) redeliver the same event — a
    // registration already marked 'paid' means an earlier delivery (or
    // the other of the two event types this handler listens for) already
    // did this, so skip re-writing and re-emailing.
    if (payment?.status === "paid") return false;
    tx.update(regRef, {
      "payment.status": "paid",
      "payment.paidAt": Timestamp.now(),
      "payment.paymentIntentId": typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
      status: "confirmed"
    });
    return true;
  });

  if (justPaid) {
    try {
      const appOrigin = session.success_url ? new URL(session.success_url).origin : "";
      await sendTicketConfirmationEmail(db, appOrigin, clubId, kind, registrationId);
    } catch (err) {
      // The payment itself is already recorded at this point — a failure
      // here only means the confirmation email didn't go out, not that
      // anything about the charge/booking is wrong, so this doesn't
      // change the 200 response below (a 5xx would just make Stripe
      // retry an event whose Firestore write already succeeded and is
      // correctly guarded as a no-op on replay).
      logger.error("Failed to send payment confirmation email", err);
    }
  }

  res.status(200).send("ok");
});

interface SendTrainingConfirmationEmailInput {
  clubId: string;
  kind: RegistrationKind;
  registrationId: string;
  // See CreateTicketCheckoutSessionInput's own doc comment above — same
  // "frontend has to tell us its own origin" reasoning.
  appOrigin: string;
}

/**
 * Sends a FREE (non-payment) registration's real confirmation email —
 * called directly by the client the moment a session/bundle registration
 * goes 'confirmed' (instant-confirm, clicking the pending-confirmation
 * email link, or a waitlist promotion; see
 * src/lib/trainingConfirmationEmail.ts for the three call sites). Reuses
 * sendTicketConfirmationEmail as-is — the exact same PDF-ticket-per-
 * RegistrationTicket builder the Stripe webhook above already uses for a
 * PAID registration — so a free registration's QR reaches the customer
 * the identical, already-proven way (a real PDF attachment) instead of
 * the old inline <img> the free path used to build client-side, which
 * several mobile mail clients (confirmed live: Gmail on iOS) silently
 * drop or fail to render.
 *
 * Public/no-auth, same trust level as createTicketCheckoutSession above —
 * knowing a registration's Firestore auto-id is already the de facto
 * "proof this is yours" this app accepts elsewhere. Re-reads the
 * registration itself (rather than trusting whatever the client claims)
 * so this can never be used to email someone else's ticket to the wrong
 * club/registration pairing.
 */
export const sendTrainingConfirmationEmail = onCall(async (request) => {
  const data = (request.data ?? {}) as Partial<SendTrainingConfirmationEmailInput>;
  const { clubId, kind, registrationId, appOrigin } = data;
  if (!clubId || !registrationId || !appOrigin || (kind !== "session" && kind !== "bundle")) {
    throw new HttpsError("invalid-argument", "Missing clubId/kind/registrationId/appOrigin.");
  }

  const db = getFirestore();
  const regSnap = await db.doc(`${registrationCollection(kind)}/${registrationId}`).get();
  const reg = regSnap.data() as { clubId?: string } | undefined;
  if (!reg || reg.clubId !== clubId) {
    throw new HttpsError("not-found", "Registration not found.");
  }

  await sendTicketConfirmationEmail(db, appOrigin, clubId, kind, registrationId);
  return { ok: true };
});
