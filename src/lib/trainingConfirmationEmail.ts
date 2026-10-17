import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'

// ---------------------------------------------------------------------
// The client side of sendTrainingConfirmationEmail
// (functions/src/payments.ts) — queues a FREE (non-payment) training/
// bundle registration's real confirmation email server-side, reusing the
// exact same PDF-ticket builder (one page per RegistrationTicket, each
// with its own QR) the Stripe webhook already uses for a PAID
// registration. Before this, the free path built its QR codes as inline
// <img src="data:..."> tags in the HTML body (buildTicketQrBlocksHtml,
// src/lib/email.ts) — several mobile mail clients (confirmed live: Gmail
// on iOS) silently drop or fail to render those, the same display problem
// already fixed for the paid flow. Routing both flows through the same
// server-side builder fixes it here too without re-solving the
// Slovak-diacritics PDF font problem in a second (browser-side) library.
// ---------------------------------------------------------------------

export interface SendTrainingConfirmationEmailInput {
  clubId: string
  kind: 'session' | 'bundle'
  registrationId: string
}

const sendTrainingConfirmationEmailCallable = httpsCallable<SendTrainingConfirmationEmailInput & { appOrigin: string }, { ok: boolean }>(
  functions,
  'sendTrainingConfirmationEmail'
)

/**
 * Queues the real confirmation email (PDF ticket attachment, calendar
 * invite, cancel link) for an already-`confirmed` session/bundle
 * registration. Call this instead of building the email client-side
 * whenever a free registration goes 'confirmed' — instant-confirm,
 * clicking the pending-confirmation email link, or a waitlist promotion.
 */
export async function sendTrainingConfirmationEmail(input: SendTrainingConfirmationEmailInput): Promise<void> {
  await sendTrainingConfirmationEmailCallable({ ...input, appOrigin: window.location.origin })
}
