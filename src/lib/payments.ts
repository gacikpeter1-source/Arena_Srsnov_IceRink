import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'

// ---------------------------------------------------------------------
// Real-money ticket/training payments via Stripe Connect — the client
// side of createTicketCheckoutSession (functions/src/payments.ts). See
// that file's own doc comment for the full architecture: a Direct-charge
// Checkout Session created on the club's own connected account, with a
// webhook (not this module) the only thing that ever flips a
// registration's `payment.status` to 'paid'.
// ---------------------------------------------------------------------

export interface CreateTicketCheckoutSessionInput {
  clubId: string
  kind: 'session' | 'bundle'
  registrationId: string
}

const createTicketCheckoutSessionCallable = httpsCallable<
  CreateTicketCheckoutSessionInput & { appOrigin: string },
  { url: string }
>(functions, 'createTicketCheckoutSession')

/**
 * Creates a Stripe Checkout Session for one already-created, still-unpaid
 * training registration and returns its hosted-page URL — the caller is
 * expected to redirect the browser there immediately
 * (`window.location.href = url`), same as `TrainingRegistrationModal.tsx`
 * does right after calling this.
 */
export async function createTicketCheckoutSession(input: CreateTicketCheckoutSessionInput): Promise<string> {
  const result = await createTicketCheckoutSessionCallable({ ...input, appOrigin: window.location.origin })
  return result.data.url
}
