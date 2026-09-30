import { collection, doc, getDoc, getDocs, query, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { deleteTournamentMatch } from './tournaments'
import { deleteRinkScheduleEntry } from './rinkSchedule'
import { fetchBookingsInRange } from './bookings'
import { timeToMinutes } from './utils'
import { RinkScheduleEntry, Zone } from '@/types'

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

/** Shared by findSlotConflict/findOverlapConflict: traces a real booking id
 * back to whichever planning tool (if any) created it. */
async function describeBookingOwner(bookingId: string, name: string, seriesId?: string): Promise<SlotConflict> {
  const matchSnap = await getDocs(
    query(collection(db, 'tournamentMatches'), where('bookingId', '==', bookingId))
  )
  if (!matchSnap.empty) {
    const m = matchSnap.docs[0].data() as { teamA: string; teamB: string }
    return { kind: 'tournament', label: `${m.teamA} – ${m.teamB}`, ownerId: matchSnap.docs[0].id }
  }

  const entryByBooking = await getDocs(
    query(collection(db, 'rinkScheduleEntries'), where('bookingId', '==', bookingId))
  )
  if (!entryByBooking.empty) {
    const e = entryByBooking.docs[0].data() as RinkScheduleEntry
    return { kind: 'schedule', label: e.teamName, ownerId: entryByBooking.docs[0].id }
  }
  if (seriesId) {
    const entryBySeries = await getDocs(
      query(collection(db, 'rinkScheduleEntries'), where('seriesId', '==', seriesId))
    )
    if (!entryBySeries.empty) {
      const e = entryBySeries.docs[0].data() as RinkScheduleEntry
      return { kind: 'schedule', label: e.teamName, ownerId: entryBySeries.docs[0].id }
    }
  }

  return { kind: 'booking', label: name }
}

/**
 * Looks up whether a rink zone/date/time is already held by a real, active
 * booking, and if so, which planning tool (if any) put it there. Returns
 * null when the slot is free — no lock at all, or one left behind by an
 * expired/reclaimable pending booking (see PENDING_CONFIRMATION_MINUTES),
 * which isn't a real conflict. Safe to call speculatively (e.g. on every
 * form-field change) since it only reads.
 *
 * This only ever matches an *exact* zoneId+date+startTime key — the same
 * thing createBooking's transaction itself locks against. See
 * findOverlapConflict below for the real time-interval check needed once
 * sessions don't all start on a clean grid.
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

  return describeBookingOwner(lock.bookingId, booking.name, booking.seriesId)
}

/**
 * Real time-interval overlap check across a whole rink — unlike
 * findSlotConflict above (which only matches an *exact* zoneId+date+
 * startTime key), this catches two bookings that start at different times
 * but still occupy the same physical ice at an overlapping moment. That
 * matters here specifically because sessions are NOT all on a clean hourly
 * grid — a configurable cleaning/prep break between sessions (see
 * TimeSlotConfig.breakMinutes) and free-form staff-entered times (rink
 * schedule entries, tournament matches) mean a real start time can be
 * anything (11:30, 14:35, ...), so "different exact start time" does not
 * mean "no conflict".
 *
 * Sessions on the exact same zone are compared directly. A 'full' booking
 * is additionally checked against every other zone on that rink and
 * vice-versa, since 'full' occupies the whole rink. Two zones of the same
 * split mode (e.g. two different thirds) never overlap each other by
 * construction, so they're not cross-checked — nor are two *different*
 * split modes (half vs third): this app has no stored mapping of which
 * half corresponds to which thirds, so that particular cross-check is a
 * known, documented gap rather than a guess.
 */
export async function findOverlapConflict(
  clubId: string,
  rinkId: string,
  zoneId: string,
  zones: Zone[],
  date: string,
  startTime: string,
  durationMinutes: number,
  excludeBookingId?: string
): Promise<SlotConflict | null> {
  const targetZone = zones.find((z) => z.id === zoneId)
  const fullZoneIds = zones.filter((z) => z.rinkId === rinkId && z.mode === 'full').map((z) => z.id)
  const candidateZoneIds =
    targetZone?.mode === 'full' ? zones.filter((z) => z.rinkId === rinkId).map((z) => z.id) : [zoneId, ...fullZoneIds]

  const newStart = timeToMinutes(startTime)
  const newEnd = newStart + durationMinutes

  const bookings = await fetchBookingsInRange(clubId, date, date)
  for (const b of bookings) {
    if (b.id === excludeBookingId) continue
    if (b.rinkId !== rinkId || !candidateZoneIds.includes(b.zoneId)) continue
    if (b.status !== 'confirmed' && b.status !== 'pending') continue
    const existStart = timeToMinutes(b.startTime)
    const existEnd = existStart + b.durationMinutes
    if (newStart < existEnd && existStart < newEnd) {
      return describeBookingOwner(b.id, b.name, b.seriesId)
    }
  }
  return null
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
