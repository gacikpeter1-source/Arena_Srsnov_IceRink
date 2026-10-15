import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

/**
 * Fire-and-forget signal for the ESP32 turnstile controller — written
 * right after a successful entrance scan on QrScanPage.tsx. One doc per
 * club (`gateTriggers/{clubId}`), overwritten on every scan: `openedAt`
 * marks a fresh open request, `consumed` starts false and is flipped to
 * true by the gateStatus Cloud Function (functions/src/gate.ts) the first
 * time the ESP32 polls it, so a device that polls every ~1s only ever
 * opens once per scan rather than repeatedly for the same trigger.
 *
 * Deliberately swallows its own errors (same "a notification, not a
 * precondition" stance this app already takes for queueing email, see
 * lib/email.ts's queueEmail) — a hardware/network hiccup on the gate side
 * must never block or fail the actual check-in the staff member is doing.
 */
export async function triggerGateOpen(clubId: string): Promise<void> {
  try {
    await setDoc(doc(db, 'gateTriggers', clubId), { openedAt: serverTimestamp(), consumed: false })
  } catch (err) {
    console.warn('Could not trigger gate open:', err)
  }
}
