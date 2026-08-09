// No functions deployed yet. Booking creation/cancellation and email
// queuing currently happen client-side (see src/lib/bookings.ts,
// src/lib/email.ts), same mechanism as the Arena-Srsnov reference app.
// Candidates for moving server-side later: booking lookup/cancel (to
// avoid querying the `bookings` collection directly from the client)
// and payment webhook handling once paymentsEnabled goes live.
