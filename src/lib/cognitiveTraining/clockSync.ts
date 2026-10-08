import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'

// A plain onCall (not onRequest) specifically so this reuses the exact
// same already-initialized Functions SDK/httpsCallable pattern every
// other Cloud Function call in this app already uses (see
// deleteStaffAccountCallable in lib/staff.ts) — callable functions work
// fine for an unauthenticated caller (the TV has no login; request.auth
// is simply null/unused server-side here), so there was no need for a
// one-off raw-HTTP endpoint just for this.
const serverTimeCallable = httpsCallable<void, { now: number }>(functions, 'cognitiveServerTime')

const CLOCK_SYNC_SAMPLES = 5

/**
 * Measures this device's clock offset from the server: `localNow() ==
 * Date.now() + offsetMs` should equal the server's own clock at that same
 * real-world instant. Takes several round trips (NTP-style) and uses the
 * sample with the lowest round-trip latency, since that's the one whose
 * "halfway point" assumption (server received the request and replied at
 * the midpoint of the round trip) is least likely to be thrown off by a
 * slow/congested network — relevant here given the explicit "slow stadium
 * wifi" requirement this whole sync design is built around.
 */
export async function measureClockOffsetMs(): Promise<number> {
  let best: { offsetMs: number; rttMs: number } | null = null
  for (let i = 0; i < CLOCK_SYNC_SAMPLES; i++) {
    const sentAt = Date.now()
    const result = await serverTimeCallable()
    const receivedAt = Date.now()
    const rttMs = receivedAt - sentAt
    const offsetMs = result.data.now - (sentAt + receivedAt) / 2
    if (!best || rttMs < best.rttMs) {
      best = { offsetMs, rttMs }
    }
  }
  return best ? best.offsetMs : 0
}

/** `Date.now()` adjusted by a previously-measured clockOffsetMs — this device's best estimate of the server's current clock. */
export function localNowMs(clockOffsetMs: number): number {
  return Date.now() + clockOffsetMs
}
