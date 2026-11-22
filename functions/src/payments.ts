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

// ---------------------------------------------------------------------
// Entrance kiosk ("Riešenie 2" in CLAUDE.md) — a self-service tablet at
// the door where a customer taps tiles to build an order (see
// KioskProduct/KioskOrder, src/types/index.ts, and KioskPage.tsx), pays by
// card, then chooses to print or email their ticket. One KioskOrder can
// cover several different products/variants/quantities at once, so its
// Checkout Session always gets one line_item per order line (an itemized
// Stripe receipt) rather than one lump sum, unlike the single-price
// training flow above. Deliberately its own small set of functions
// (not a `kind: "kiosk"` branch bolted onto the training-specific types
// above) since a kiosk order's shape (`lines`, no `tickets`/attendeeCount)
// genuinely differs from a registration's.
// ---------------------------------------------------------------------

interface KioskOrderLineData {
  productName: string;
  variantName: string;
  unitPrice: number;
  qty: number;
}

function kioskCheckInPath(orderId: string, token: string): string {
  return `/kiosk/vstup/${orderId}/${token}`;
}

interface CreateKioskCheckoutSessionInput {
  clubId: string;
  orderId: string;
  appOrigin: string;
  // See src/lib/kiosk.ts's own doc comment on this field.
  viaPhone?: boolean;
}

/**
 * Creates a Stripe Checkout Session for one already-created, still-pending
 * KioskOrder — createKioskOrder (src/lib/kiosk.ts) already decided the
 * lines/amounts before this is ever called; this function only reads
 * what's already there. Public/no-auth, same trust level as
 * createTicketCheckoutSession above.
 */
export const createKioskCheckoutSession = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const data = (request.data ?? {}) as Partial<CreateKioskCheckoutSessionInput>;
  const { clubId, orderId, appOrigin, viaPhone } = data;
  if (!clubId || !orderId || !appOrigin) {
    throw new HttpsError("invalid-argument", "Missing clubId/orderId/appOrigin.");
  }
  const returnSuffix = viaPhone ? "&src=phone" : "";

  const db = getFirestore();
  const clubSnap = await db.doc(`clubs/${clubId}`).get();
  const club = clubSnap.data() as { stripeAccountId?: string; paymentsEnabled?: boolean } | undefined;
  if (!club?.stripeAccountId) {
    throw new HttpsError("failed-precondition", "This club has no connected Stripe account.");
  }
  if (!club.paymentsEnabled) {
    throw new HttpsError("failed-precondition", "Payments are not enabled for this club.");
  }

  const orderRef = db.doc(`kioskOrders/${orderId}`);
  const orderSnap = await orderRef.get();
  const order = orderSnap.data() as { clubId?: string; status?: string; lines?: KioskOrderLineData[] } | undefined;
  if (!order || order.clubId !== clubId) {
    throw new HttpsError("not-found", "Order not found.");
  }
  if (order.status !== "pending" || !order.lines || order.lines.length === 0) {
    throw new HttpsError("failed-precondition", "This order has no pending payment to collect.");
  }

  const stripe = new Stripe(stripeSecretKey.value());
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: order.lines.map((line) => ({
        price_data: {
          currency: "eur",
          product_data: { name: `${line.productName} — ${line.variantName}` },
          unit_amount: Math.round(line.unitPrice * 100)
        },
        quantity: line.qty
      })),
      success_url: `${appOrigin}/kiosk?status=success&orderId=${orderId}${returnSuffix}`,
      cancel_url: `${appOrigin}/kiosk?status=cancelled&orderId=${orderId}${returnSuffix}`,
      metadata: { clubId, kind: "kiosk", orderId },
      payment_intent_data: { metadata: { clubId, kind: "kiosk", orderId } }
    },
    { stripeAccount: club.stripeAccountId }
  );

  if (!session.url) {
    throw new HttpsError("internal", "Stripe did not return a Checkout Session URL.");
  }

  await orderRef.update({ checkoutSessionId: session.id, checkoutUrl: session.url });
  return { url: session.url };
});

/**
 * A single-page PDF ticket for a whole KioskOrder — unlike
 * buildTicketsPdfBase64 above (one page per person), a kiosk order is
 * always checked in as one unit (see gateScanCheckIn's kiosk branch,
 * functions/src/gate.ts), so one QR covers the whole purchase regardless
 * of how many lines/quantities it has.
 */
function buildKioskOrderPdfBase64(params: {
  clubName: string;
  confirmationCode: string;
  lines: KioskOrderLineData[];
  totalAmount: number;
  qrPngBuffer: Buffer;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A5", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
    doc.on("error", reject);

    doc.registerFont("Regular", FONT_REGULAR);
    doc.registerFont("Bold", FONT_BOLD);

    doc.fontSize(18).font("Bold").text(params.clubName, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(14).font("Bold").text("Vstupenka", { align: "center" });
    doc.moveDown(1);

    doc.fontSize(11).font("Regular");
    params.lines.forEach((line) => {
      doc.text(`${line.qty}× ${line.productName} — ${line.variantName}  (${(line.unitPrice * line.qty).toFixed(2).replace(".", ",")} €)`);
    });
    doc.moveDown(0.5);
    doc.font("Bold").text(`Spolu: ${params.totalAmount.toFixed(2).replace(".", ",")} €`);
    doc.font("Regular").text(`Potvrdzovací kód: ${params.confirmationCode}`);
    doc.moveDown(1.5);

    const qrSize = 220;
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const qrX = doc.page.margins.left + (contentWidth - qrSize) / 2;
    doc.image(params.qrPngBuffer, qrX, doc.y, { width: qrSize, height: qrSize });
    doc.y += qrSize + 12;

    doc.fontSize(10).fillColor("#666666").text("Naskenujte tento QR kód pri vstupe.", { align: "center" });
    doc.fillColor("#000000");

    doc.end();
  });
}

interface SendKioskOrderEmailInput {
  clubId: string;
  orderId: string;
  email: string;
  appOrigin: string;
}

/**
 * Emails a paid KioskOrder's ticket (PDF, same reasoning as
 * sendTicketConfirmationEmail above for why it's a real attachment and not
 * an inline <img>) — called directly by the kiosk once the customer
 * chooses "Poslať e-mailom" over printing, so the email address is never
 * collected before payment (an anonymous walk-up purchase otherwise needs
 * no contact info at all). Re-reads the order itself rather than trusting
 * whatever the client claims, same trust boundary as every other public
 * callable in this file.
 */
export const sendKioskOrderEmail = onCall(async (request) => {
  const data = (request.data ?? {}) as Partial<SendKioskOrderEmailInput>;
  const { clubId, orderId, email, appOrigin } = data;
  if (!clubId || !orderId || !email || !appOrigin) {
    throw new HttpsError("invalid-argument", "Missing clubId/orderId/email/appOrigin.");
  }

  const db = getFirestore();
  const [orderSnap, clubSnap] = await Promise.all([db.doc(`kioskOrders/${orderId}`).get(), db.doc(`clubs/${clubId}`).get()]);
  const order = orderSnap.data() as
    | {
        clubId?: string;
        status?: string;
        confirmationCode?: string;
        cancellationToken?: string;
        lines?: KioskOrderLineData[];
        totalAmount?: number;
      }
    | undefined;
  if (!order || order.clubId !== clubId) {
    throw new HttpsError("not-found", "Order not found.");
  }
  if (order.status !== "paid" || !order.cancellationToken || !order.confirmationCode) {
    throw new HttpsError("failed-precondition", "This order isn't paid yet.");
  }
  const clubName = (clubSnap.data() as { name?: string } | undefined)?.name ?? "";

  const checkInUrl = `${appOrigin}${kioskCheckInPath(orderId, order.cancellationToken)}`;
  const qrPngBuffer = await QRCode.toBuffer(checkInUrl, { width: 320, margin: 2 });
  const pdfBase64 = await buildKioskOrderPdfBase64({
    clubName,
    confirmationCode: order.confirmationCode,
    lines: order.lines ?? [],
    totalAmount: order.totalAmount ?? 0,
    qrPngBuffer
  });

  await db.collection("mail").add({
    to: email,
    message: {
      subject: `Vstupenka – ${clubName}`,
      html: `<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
        <h2 style="margin: 0 0 16px;">${clubName}</h2>
        <p>Ďakujeme za nákup. Vaša vstupenka s QR kódom je priložená ako PDF súbor.</p>
        <p style="margin: 4px 0;">Potvrdzovací kód: <strong>${order.confirmationCode}</strong></p>
      </div>`
    },
    attachments: [{ filename: "vstupenka.pdf", content: pdfBase64, contentType: "application/pdf", encoding: "base64" }]
  });

  await db.doc(`kioskOrders/${orderId}`).update({ deliveryEmail: email });

  return { ok: true };
});

interface CreateKioskTerminalConnectionTokenInput {
  clubId: string;
}

/**
 * A Stripe Terminal connection token, scoped to the club's connected
 * account — the native Android kiosk-wrapper app (see hardware/android-
 * kiosk-wrapper's own README, which doesn't exist in this web project;
 * the wrapper app is a separate native project) calls this once per
 * Terminal SDK session to authenticate itself with Stripe before it can
 * discover/connect to the WisePad 3 reader. Public/no-auth, same trust
 * level as every other callable in this file — a connection token alone
 * can't charge anything on its own, it only lets the SDK talk to Stripe at
 * all.
 */
export const createKioskTerminalConnectionToken = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const { clubId } = (request.data ?? {}) as Partial<CreateKioskTerminalConnectionTokenInput>;
  if (!clubId) {
    throw new HttpsError("invalid-argument", "Missing clubId.");
  }

  const db = getFirestore();
  const clubSnap = await db.doc(`clubs/${clubId}`).get();
  const club = clubSnap.data() as { stripeAccountId?: string } | undefined;
  if (!club?.stripeAccountId) {
    throw new HttpsError("failed-precondition", "This club has no connected Stripe account.");
  }

  const stripe = new Stripe(stripeSecretKey.value());
  const connectionToken = await stripe.terminal.connectionTokens.create({}, { stripeAccount: club.stripeAccountId });
  return { secret: connectionToken.secret };
});

interface CreateKioskTerminalPaymentIntentInput {
  clubId: string;
  orderId: string;
}

/**
 * A card-present PaymentIntent for one already-created, still-pending
 * KioskOrder — the native wrapper app's counterpart to
 * createKioskCheckoutSession above, used when the kiosk is driven by the
 * physical WisePad 3 reader instead of redirecting to a hosted Checkout
 * page. The wrapper app passes the returned `clientSecret` straight into
 * the Terminal SDK's own collectPaymentMethod/confirmPaymentIntent calls;
 * this function never talks to the reader itself, it only ever decides
 * the amount (read from the order, never trusted from the caller).
 */
export const createKioskTerminalPaymentIntent = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const { clubId, orderId } = (request.data ?? {}) as Partial<CreateKioskTerminalPaymentIntentInput>;
  if (!clubId || !orderId) {
    throw new HttpsError("invalid-argument", "Missing clubId/orderId.");
  }

  const db = getFirestore();
  const clubSnap = await db.doc(`clubs/${clubId}`).get();
  const club = clubSnap.data() as { stripeAccountId?: string; paymentsEnabled?: boolean } | undefined;
  if (!club?.stripeAccountId) {
    throw new HttpsError("failed-precondition", "This club has no connected Stripe account.");
  }
  if (!club.paymentsEnabled) {
    throw new HttpsError("failed-precondition", "Payments are not enabled for this club.");
  }

  const orderRef = db.doc(`kioskOrders/${orderId}`);
  const orderSnap = await orderRef.get();
  const order = orderSnap.data() as { clubId?: string; status?: string; totalAmount?: number } | undefined;
  if (!order || order.clubId !== clubId) {
    throw new HttpsError("not-found", "Order not found.");
  }
  if (order.status !== "pending" || !order.totalAmount) {
    throw new HttpsError("failed-precondition", "This order has no pending payment to collect.");
  }

  const stripe = new Stripe(stripeSecretKey.value());
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: Math.round(order.totalAmount * 100),
      currency: "eur",
      payment_method_types: ["card_present"],
      capture_method: "automatic",
      metadata: { clubId, kind: "kiosk-terminal", orderId }
    },
    { stripeAccount: club.stripeAccountId }
  );

  await orderRef.update({ paymentIntentId: paymentIntent.id });
  return { clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id };
});

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

  // Card-present kiosk payments (the native WisePad-3 wrapper app, via
  // createKioskTerminalPaymentIntent above) confirm through a PaymentIntent
  // directly, never a Checkout Session, so they arrive as their own event
  // type — handled separately from the Checkout-based flows below, which
  // never produce a payment_intent.succeeded event carrying this metadata
  // shape. The live webhook listens to a broad set of event types (see
  // CLAUDE.md), so payment_intent.succeeded is almost certainly already
  // selected on the Stripe Dashboard side; if it isn't, this branch simply
  // never fires and the order sits 'pending' — check the dashboard's event
  // selection if a Terminal payment doesn't mark an order paid.
  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const metadata = paymentIntent.metadata ?? {};
    if (metadata.kind !== "kiosk-terminal") {
      // Not a kiosk Terminal payment — nothing else in this app currently
      // needs this event type.
      res.status(200).send("ignored");
      return;
    }
    const { clubId, orderId } = metadata;
    if (!clubId || !orderId) {
      logger.warn("Stripe webhook: kiosk-terminal payment_intent missing expected metadata", { paymentIntentId: paymentIntent.id });
      res.status(200).send("missing metadata");
      return;
    }
    const db = getFirestore();
    const orderRef = db.doc(`kioskOrders/${orderId}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) return;
      const order = snap.data() as { status?: string };
      // Idempotency: Stripe can (and does) redeliver the same event.
      if (order.status === "paid") return;
      tx.update(orderRef, { status: "paid", paidAt: Timestamp.now(), paymentIntentId: paymentIntent.id });
    });
    res.status(200).send("ok");
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

  // Kiosk orders are handled entirely separately from the training
  // session/bundle flow below — a different collection, different fields
  // (`status` directly on the doc, not nested under `payment.`), and
  // deliberately NO automatic confirmation email here: the customer picks
  // print-or-email AFTER returning to the kiosk's own success screen (see
  // sendKioskOrderEmail above), since an anonymous walk-up purchase never
  // collects an email address before payment at all.
  if (metadata.kind === "kiosk") {
    const orderId = metadata.orderId;
    if (!clubId || !orderId) {
      logger.warn("Stripe webhook: kiosk checkout session missing expected metadata", { sessionId: session.id });
      res.status(200).send("missing metadata");
      return;
    }
    const db = getFirestore();
    const orderRef = db.doc(`kioskOrders/${orderId}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) return;
      const order = snap.data() as { status?: string };
      // Idempotency: Stripe can (and does) redeliver the same event.
      if (order.status === "paid") return;
      tx.update(orderRef, {
        status: "paid",
        paidAt: Timestamp.now(),
        paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null)
      });
    });
    res.status(200).send("ok");
    return;
  }

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
