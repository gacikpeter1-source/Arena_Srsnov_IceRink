import { doc, updateDoc, deleteField, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { Club, ClubEntitlement } from '@/types'

export type EntitlementKey = 'treningy' | 'turnaje'

// Every gate-able add-on module, in display order — the single place a
// new paid module gets registered (AdminSubscriptionPage.tsx and
// firestore.rules' allow-listed keys should stay in sync with this).
export const ENTITLEMENT_KEYS: EntitlementKey[] = ['treningy', 'turnaje']

/**
 * True only when the module is actually usable right now — enabled AND
 * (no expiry, or the expiry hasn't passed yet). A missing entitlement
 * entirely (a club predating this feature, or a module never activated)
 * reads as inactive, never as "unlimited by default" — nothing is free
 * just because it wasn't explicitly turned off.
 */
export function isEntitlementActive(entitlement: ClubEntitlement | undefined): boolean {
  if (!entitlement?.enabled) return false
  if (!entitlement.expiresAt) return true
  // Firestore hands this back as a Timestamp at runtime even though the
  // type says Date (same convention lib/bookings.ts's isLockExpired
  // already follows for expiresAt-style fields).
  return (entitlement.expiresAt as unknown as Timestamp).toMillis() > Date.now()
}

/**
 * Turns a module on, starting from today — always "N days from the
 * moment of activation", never from some other reference date, so
 * re-activating an already-expired pay-as-you-go module always gives a
 * fresh full window rather than whatever time happened to be left.
 * `days` omitted means unlimited/permanent (clears any prior expiry).
 * Superadmin-only, enforced by firestore.rules on `clubs/{clubId}`.
 */
export async function activateEntitlement(clubId: string, key: EntitlementKey, days?: number): Promise<void> {
  const expiresAt = days != null ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null
  await updateDoc(doc(db, 'clubs', clubId), {
    [`entitlements.${key}.enabled`]: true,
    [`entitlements.${key}.expiresAt`]: expiresAt
  })
}

export async function deactivateEntitlement(clubId: string, key: EntitlementKey): Promise<void> {
  await updateDoc(doc(db, 'clubs', clubId), {
    [`entitlements.${key}.enabled`]: false,
    [`entitlements.${key}.expiresAt`]: deleteField()
  })
}

/** Convenience reader — `club` is nullable since callers usually get it straight from useClubData. */
export function isModuleActive(club: Club | null, key: EntitlementKey): boolean {
  return isEntitlementActive(club?.entitlements?.[key])
}
