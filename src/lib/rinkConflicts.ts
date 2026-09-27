import { collection, doc, getDoc, getDocs, query, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { deleteTournamentMatch } from './tournaments'
import { deleteRinkScheduleEntry } from './rinkSchedule'
import { RinkScheduleEntry } from '@/types'

// Cross-domain conflict lookup between tournament matches and the rink
// team schedule — see CLAUDE.md's "Tournament ↔ rink schedule conflicts"
// section. Both TournamentMatch (via blocksIce + bookingId) and
// RinkScheduleEntry (via bookingId/seriesId) reserve real ice through the
// exact same createBooking/createBookingSeries transaction, so whichever
// one got a slot first is always findable by tracing the real Booking's
// slotLocks doc back to whichever planning collection references it —
// no new source of truth, just a lookup across two existing ones.

export type SlotConflictKind = 'tournament' | 'schedule' | 'booking'

export interface SlotConflict {
  kind: SlotConflictKind
  label: string
  // The TournamentMatch/RinkScheduleEntry doc id that owns the booking —
  // unset for a plain customer booking neither planning tool created,
  // which this app never offers to auto-cancel on a staff member's behalf.
  ownerId?: string
}

/**
 * Looks up whether a rink zone/date/time is already held by a real, active
 * booking, and if so, which planning tool (if any) put it there. Returns
 * null when the slot is free — no lock at all, or one left behind by an
 * expired/reclaimable pending booking (see PENDING_CONFIRMATION_MINUTES),
 * which isn't a real conflict. Safe to call speculatively (e.g. on every
 * form-field change) since it only reads.
 */
export async function findSlotConflict(
  clubId: string,
  zoneId: string,
  date: string,
  startTime: string
): Promise<SlotConflict | null> {
  const lockSnap = await getDocs(
    query(
      collection(db, 'slotLocks'),
      where('clubId', '==', clubId),
      where('zoneId', '==', zoneId),
      where('date', '==', date),
      where('startTime', '==', startTime)
    )
  )
  if (lockSnap.empty) return null
  const lock = lockSnap.docs[0].data() as { bookingId: string; expiresAt?: Timestamp }
  if (lock.expiresAt && lock.expiresAt.toMillis() < Date.now()) return null

  const bookingSnap = await getDoc(doc(db, 'bookings', lock.bookingId))
  if (!bookingSnap.exists()) return null
  const booking = bookingSnap.data() as { status: string; name: string; seriesId?: string }
  if (booking.status === 'cancelled' || booking.status === 'expired') return null

  const matchSnap = await getDocs(
    query(collection(db, 'tournamentMatches'), where('bookingId', '==', lock.bookingId))
  )
  if (!matchSnap.empty) {
    const m = matchSnap.docs[0].data() as { teamA: string; teamB: string }
    return { kind: 'tournament', label: `${m.teamA} – ${m.teamB}`, ownerId: matchSnap.docs[0].id }
  }

  const entryByBooking = await getDocs(
    query(collection(db, 'rinkScheduleEntries'), where('bookingId', '==', lock.bookingId))
  )
  if (!entryByBooking.empty) {
    const e = entryByBooking.docs[0].data() as RinkScheduleEntry
    return { kind: 'schedule', label: e.teamName, ownerId: entryByBooking.docs[0].id }
  }
  if (booking.seriesId) {
    const entryBySeries = await getDocs(
      query(collection(db, 'rinkScheduleEntries'), where('seriesId', '==', booking.seriesId))
    )
    if (!entryBySeries.empty) {
      const e = entryBySeries.docs[0].data() as RinkScheduleEntry
      return { kind: 'schedule', label: e.teamName, ownerId: entryBySeries.docs[0].id }
    }
  }

  return { kind: 'booking', label: booking.name }
}

/**
 * Cancels whichever planning-tool doc owns a conflict found by
 * findSlotConflict, freeing the slot for a replacement — only ever called
 * after explicit staff confirmation. No-ops for a plain customer booking
 * (kind: 'booking', no ownerId): this app never lets one planning tool
 * silently cancel a real customer's reservation on the other's behalf, so
 * callers should not offer a "replace" choice for that kind at all.
 */
export async function resolveSlotConflict(conflict: SlotConflict): Promise<void> {
  if (!conflict.ownerId) return
  if (conflict.kind === 'tournament') {
    await deleteTournamentMatch(conflict.ownerId)
  } else if (conflict.kind === 'schedule') {
    const snap = await getDoc(doc(db, 'rinkScheduleEntries', conflict.ownerId))
    if (snap.exists()) {
      await deleteRinkScheduleEntry({ ...(snap.data() as RinkScheduleEntry), id: snap.id })
    }
  }
}
