// Builds the Stripe Connect OAuth "authorize" URL an owner/superadmin is
// sent to from AdminClubSettingsPanel.tsx's "Pripojiť Stripe účet" button.
// `state` carries the clubId through the round trip unchanged — Stripe
// hands it straight back on the redirect, and stripeConnectCallback
// (functions/src/index.ts) uses it to know which club's doc to write the
// resulting connected account id onto. No extra CSRF nonce beyond that:
// this link is only ever reachable from the already-authenticated admin
// panel, same trust level as every other owner/superadmin-only action in
// this app.
export function buildStripeConnectAuthorizeUrl(clubId: string): string {
  const clientId = import.meta.env.VITE_STRIPE_CONNECT_CLIENT_ID
  const redirectUri = import.meta.env.VITE_STRIPE_CONNECT_REDIRECT_URI
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'read_write',
    redirect_uri: redirectUri,
    state: clubId
  })
  return `https://connect.stripe.com/oauth/authorize?${params.toString()}`
}
