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
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import * as QRCode from "qrcode";

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

const STRINGS: Record<Lang, { subject: (club: string) => string; greeting: (name: string) => string; intro: string; code: string; cancelIntro: string; cancelButton: string }> = {
  sk: {
    subject: (club) => `Platba prijatá – ${club}`,
    greeting: (name) => `Dobrý deň, ${name},`,
    intro: "Vaša platba bola úspešne prijatá a vaša rezervácia je potvrdená.",
    code: "Potvrdzovací kód",
    cancelIntro: "Rezerváciu môžete zrušiť tu, alebo naskenovať QR kód pri vstupe:",
    cancelButton: "Zrušiť rezerváciu"
  },
  en: {
    subject: (club) => `Payment received – ${club}`,
    greeting: (name) => `Hello ${name},`,
    intro: "Your payment was received and your booking is confirmed.",
    code: "Confirmation code",
    cancelIntro: "You can cancel your booking here, or scan the QR code at the entrance:",
    cancelButton: "Cancel booking"
  }
};

function buildConfirmationEmailHtml(params: { clubName: string; name: string; subtitle: string; confirmationCode: string; cancelUrl: string; qrDataUrl: string | null; lang: Lang }): string {
  const s = STRINGS[params.lang];
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
      <h2 style="margin: 0 0 16px;">${params.clubName}</h2>
      <p>${s.greeting(params.name)}</p>
      <p>${s.intro}</p>
      ${params.subtitle ? `<p style="margin: 4px 0;"><strong>${params.subtitle}</strong></p>` : ""}
      <p style="margin: 4px 0;">${s.code}: <strong>${params.confirmationCode}</strong></p>
      <div style="margin-top: 20px; padding: 15px; background: #f9fafb; border: 2px solid #e5e7eb; border-radius: 8px; text-align: center;">
        <p style="margin: 0 0 15px; font-size: 14px; color: #666;">${s.cancelIntro}</p>
        <a href="${params.cancelUrl}" style="display: inline-block; padding: 12px 30px; background: #dc2626; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
          ${s.cancelButton}
        </a>
        ${params.qrDataUrl ? `<div style="margin-top: 15px;"><img src="${params.qrDataUrl}" alt="QR" width="160" height="160" style="background: white; padding: 8px; border-radius: 8px;" /></div>` : ""}
      </div>
    </div>
  `;
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

async function sendPaymentConfirmationEmail(
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
      }
    | undefined;
  const club = clubSnap.data() as { name?: string } | undefined;
  if (!reg?.email || !reg.cancellationToken || !reg.confirmationCode) {
    logger.warn("sendPaymentConfirmationEmail: registration missing email/token/code", { registrationId });
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

  const cancelUrl = `${appOrigin}${cancelPath(kind, registrationId, reg.cancellationToken)}`;
  const qrDataUrl = await QRCode.toDataURL(cancelUrl, { width: 320, margin: 2 }).catch(() => null);

  await db.collection("mail").add({
    to: reg.email,
    message: {
      subject: STRINGS[lang].subject(clubName),
      html: buildConfirmationEmailHtml({
        clubName,
        name: reg.name ?? "",
        subtitle,
        confirmationCode: reg.confirmationCode,
        cancelUrl,
        qrDataUrl,
        lang
      })
    }
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
      await sendPaymentConfirmationEmail(db, appOrigin, clubId, kind, registrationId);
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
