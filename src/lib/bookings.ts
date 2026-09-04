import {
  collection,
  deleteField,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where
} from 'firebase/firestore'
import { db } from './firebase'
import { Booking, SeriesFrequency } from '@/types'
import { addDays, formatDateISO, generateConfirmationCode, generateToken } from './utils'
import { zonedTimeToUtc } from './ics'

export class SlotUnavailableError extends Error {
  constructor() {
    super('This zone is no longer available for the selected time.')
    this.name = 'SlotUnavailableError'
  }
}

export class BookingConfirmationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BookingConfirmationError'
  }
}

// A customer can self-cancel up to this many hours before a booking's start
// — inside the window it's "locked down" for online cancellation (staff can
// still cancel it from the admin dashboard any time, since cancelBooking
// itself has no cutoff logic — the check lives in the customer-facing pages
// and, for defense-in-depth against a direct API call, in firestore.rules).
export const CANCELLATION_CUTOFF_HOURS = 24

/**
 * True once a booking is inside its cancellation lockdown window, i.e. it's
 * too close to start for a customer to self-cancel online anymore.
 */
export function isPastCancellationCutoff(date: string, startTime: string, timezone: string): boolean {
  const startUtc = zonedTimeToUtc(date, startTime, timezone)
  const cutoff = new Date(startUtc.getTime() - CANCELLATION_CUTOFF_HOURS * 60 * 60 * 1000)
  return new Date() >= cutoff
}

function slotLockId(clubId: string, zoneId: string, date: string, startTime: string) {
  return `${clubId}__${zoneId}__${date}__${startTime}`
}

/** True if a slotLocks doc's optional `expiresAt` (see PENDING_CONFIRMATION_MINUTES) is in the past. */
function isLockExpired(expiresAt: Timestamp | undefined): boolean {
  return expiresAt != null && expiresAt.toMillis() < Date.now()
}

/**
 * Returns the set of "zoneId__startTime" pairs that are booked on the given
 * date, for display purposes (e.g. graying out taken slots in the picker).
 * Not used for the actual reservation decision — createBooking re-checks
 * inside a transaction regardless, so this is safe to read outside one. A
 * lock past its (optional) `expiresAt` — an unconfirmed pending booking that
 * timed out — is filtered out so the slot shows as available again right
 * away, without waiting for anyone to actually re-book it and trigger the
 * reclaim in createBooking's transaction.
 */
export async function fetchLockedSlots(clubId: string, date: string): Promise<Set<string>> {
  const snap = await getDocs(
    query(collection(db, 'slotLocks'), where('clubId', '==', clubId), where('date', '==', date))
  )
  return new Set(
    snap.docs.filter((d) => !isLockExpired(d.data().expiresAt)).map((d) => `${d.data().zoneId}__${d.data().startTime}`)
  )
}

/**
 * Same as fetchLockedSlots but across an inclusive date range, one Set per
 * date — powers the day-picker's occupancy indicators and the availability
 * grid, which both need to know what's taken across many days at once
 * without a per-day round trip.
 */
export async function fetchLockedSlotsRange(
  clubId: string,
  startDate: string,
  endDate: string
): Promise<Map<string, Set<string>>> {
  const snap = await getDocs(
    query(
      collection(db, 'slotLocks'),
      where('clubId', '==', clubId),
      where('date', '>=', startDate),
      where('date', '<=', endDate)
    )
  )
  const byDate = new Map<string, Set<string>>()
  for (const d of snap.docs) {
    const data = d.data() as { date: string; zoneId: string; startTime: string; expiresAt?: Timestamp }
    if (isLockExpired(data.expiresAt)) continue
    if (!byDate.has(data.date)) byDate.set(data.date, new Set())
    byDate.get(data.date)!.add(`${data.zoneId}__${data.startTime}`)
  }
  return byDate
}

// A customer-facing single booking must be confirmed via the emailed link
// within this many minutes, or its hold on the slot is released — guards
// against a typo'd email silently squatting on a slot forever, and bounds
// how long a bad-faith flood of unconfirmed bookings can occupy real slots.
// Staff-created and recurring-series bookings skip this (see
// requiresConfirmation on CreateBookingInput) — see CLAUDE.md.
export const PENDING_CONFIRMATION_MINUTES = 5

export interface CreateBookingInput {
  clubId: string
  rinkId: string
  zoneId: string
  date: string // "2026-08-07"
  startTime: string // "18:00"
  durationMinutes: number
  name: string
  email: string
  phone: string
  // Club's IANA zone (e.g. "Europe/Bratislava") — stored as startAtUtc so
  // firestore.rules can enforce the cancellation cutoff without needing its
  // own DST-aware conversion (rules have no Intl access).
  timezone: string
  // Set when this occurrence is part of a recurring series (see
  // createBookingSeries) — omitted for a normal one-off booking.
  seriesId?: string
  // When true, the booking starts as 'pending' rather than 'confirmed' and
  // must be confirmed via the emailed link within PENDING_CONFIRMATION_MINUTES
  // (see confirmBooking) or its slot lock expires and becomes reclaimable.
  // Only the public single-booking flow (BookingModal.tsx) sets this — staff
  // (AdminCreateBookingModal, Excel import) already know the contact info is
  // real, and a recurring series would need one confirmation per occurrence,
  // which is its own can of worms, so series stay instant-confirm for now.
  requiresConfirmation?: boolean
  // How many people this one booking/QR covers — see Booking.attendeeCount.
  // Purely informational (doesn't affect slot availability), unlike the
  // training domain's attendeeCount which reserves real capacity.
  attendeeCount?: number
}

export interface CreatedBooking {
  id: string
  confirmationCode: string
  cancellationToken: string
  status: 'confirmed' | 'pending'
}

/**
 * Atomically checks and reserves a zone/date/time slot.
 *
 * Only one division mode (full/half/third) is ever offered for a given
 * date/time — decided by the admin's DivisionRule schedule, resolved
 * client-side before this is called (see resolveDivisionMode in
 * lib/divisionRules.ts). Same-mode zones are physically disjoint slices of
 * the rink, so a single lock document per zoneId+date+startTime is enough
 * to prevent double-booking; no cross-zone conflict check is needed.
 *
 * A lock held by an expired, never-confirmed pending booking is silently
 * reclaimed rather than blocking the new attempt — that booking is left as
 * 'pending' with a lock nobody points to anymore; it's cleaned up to
 * 'expired' the next time anyone touches it (confirmBooking, or simply
 * filtered out of availability reads via isLockExpired).
 */
export async function createBooking(input: CreateBookingInput): Promise<CreatedBooking> {
  const lockRef = doc(db, 'slotLocks', slotLockId(input.clubId, input.zoneId, input.date, input.startTime))
  const bookingRef = doc(collection(db, 'bookings'))

  return runTransaction(db, async (tx) => {
    const lockSnap = await tx.get(lockRef)
    if (lockSnap.exists() && !isLockExpired(lockSnap.data().expiresAt)) {
      throw new SlotUnavailableError()
    }

    const confirmationCode = generateConfirmationCode()
    const cancellationToken = generateToken()
    const tokenExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    const status = input.requiresConfirmation ? 'pending' : 'confirmed'
    const pendingExpiresAt = input.requiresConfirmation
      ? new Date(Date.now() + PENDING_CONFIRMATION_MINUTES * 60 * 1000)
      : null

    tx.set(lockRef, {
      clubId: input.clubId,
      zoneId: input.zoneId,
      date: input.date,
      startTime: input.startTime,
      bookingId: bookingRef.id,
      createdAt: serverTimestamp(),
      ...(pendingExpiresAt ? { expiresAt: pendingExpiresAt } : {})
    })

    tx.set(bookingRef, {
      clubId: input.clubId,
      rinkId: input.rinkId,
      zoneId: input.zoneId,
      date: input.date,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes,
      name: input.name,
      email: input.email,
      phone: input.phone,
      // Firestore rejects `undefined` field values, so only include
      // seriesId when this occurrence actually belongs to one.
      ...(input.seriesId ? { seriesId: input.seriesId } : {}),
      ...(input.attendeeCount && input.attendeeCount > 1 ? { attendeeCount: input.attendeeCount } : {}),
      ...(pendingExpiresAt ? { pendingExpiresAt } : {}),
      confirmationCode,
      cancellationToken,
      tokenExpiresAt,
      startAtUtc: zonedTimeToUtc(input.date, input.startTime, input.timezone),
      status,
      createdAt: serverTimestamp()
    })

    return { id: bookingRef.id, confirmationCode, cancellationToken, status }
  })
}

/**
 * Confirms a still-pending booking via its emailed link, promoting it to
 * 'confirmed' and turning its slot lock permanent (clearing `expiresAt`).
 * Idempotent — calling it again on an already-confirmed booking (e.g. the
 * customer double-clicks, or revisits the link) just returns it unchanged
 * rather than erroring, so the confirm page can't accidentally re-queue a
 * second confirmation email.
 *
 * Re-checks the lock, not just the booking doc: if the 5-minute window
 * already lapsed and someone else's booking has since reclaimed the same
 * slot (see createBooking), this one is marked 'expired' instead of
 * confirming — otherwise two different customers could end up "confirmed"
 * for the same slot.
 */
export async function confirmBooking(
  bookingId: string,
  token: string
): Promise<{ booking: Booking & { id: string }; alreadyConfirmed: boolean }> {
  const bookingRef = doc(db, 'bookings', bookingId)

  return runTransaction(db, async (tx) => {
    const bookingSnap = await tx.get(bookingRef)
    if (!bookingSnap.exists()) {
      throw new BookingConfirmationError('Booking not found')
    }
    const booking = bookingSnap.data() as Omit<Booking, 'id'>
    if (booking.cancellationToken !== token) {
      throw new BookingConfirmationError('Invalid confirmation link')
    }
    if (booking.status === 'confirmed') {
      return { booking: { id: bookingId, ...booking }, alreadyConfirmed: true }
    }
    if (booking.status !== 'pending') {
      throw new BookingConfirmationError('This booking can no longer be confirmed')
    }

    const lockRef = doc(db, 'slotLocks', slotLockId(booking.clubId, booking.zoneId, booking.date, booking.startTime))
    const lockSnap = await tx.get(lockRef)
    const pendingExpiresAt = booking.pendingExpiresAt as unknown as Timestamp | undefined
    const stillOurs = lockSnap.exists() && lockSnap.data().bookingId === bookingId

    if (isLockExpired(pendingExpiresAt) || !stillOurs) {
      tx.update(bookingRef, { status: 'expired' })
      if (stillOurs) tx.delete(lockRef)
      throw new BookingConfirmationError('This booking has expired')
    }

    tx.update(bookingRef, { status: 'confirmed' })
    tx.update(lockRef, { expiresAt: deleteField() })

    return { booking: { id: bookingId, ...booking, status: 'confirmed' }, alreadyConfirmed: false }
  })
}

/**
 * Cancels a booking and releases its slot lock so the zone/time becomes
 * bookable again.
 */
export async function cancelBooking(bookingId: string): Promise<void> {
  const bookingRef = doc(db, 'bookings', bookingId)

  await runTransaction(db, async (tx) => {
    const bookingSnap = await tx.get(bookingRef)
    if (!bookingSnap.exists()) {
      throw new Error('Booking not found')
    }
    const booking = bookingSnap.data()
    if (booking.status === 'cancelled') {
      throw new Error('Booking is already cancelled')
    }

    const lockRef = doc(db, 'slotLocks', slotLockId(booking.clubId, booking.zoneId, booking.date, booking.startTime))
    tx.delete(lockRef)

    tx.update(bookingRef, {
      status: 'cancelled',
      cancelledAt: serverTimestamp()
    })
  })
}

export type SeriesRecurrence =
  | { type: 'count'; frequency: SeriesFrequency; count: number }
  | { type: 'until'; frequency: SeriesFrequency; endDate: string }

export interface CreateSeriesInput {
  clubId: string
  rinkId: string
  zoneId: string
  startDate: string // first occurrence, "2026-08-07"
  startTime: string
  durationMinutes: number
  name: string
  email: string
  phone: string
  timezone: string
  recurrence: SeriesRecurrence
  // See CreateBookingInput.attendeeCount — applied to every occurrence.
  attendeeCount?: number
}

export interface SeriesOccurrenceResult {
  bookingId: string
  date: string
  confirmationCode: string
}

export interface CreatedSeries {
  seriesId: string
  cancellationToken: string
  created: SeriesOccurrenceResult[]
  skippedDates: string[]
}

// A daily series realistically never needs to run longer than half a
// year, a weekly one longer than a year — caps a malformed end date (or
// fat-fingered count) from looping forever. Exported so the UI can bound
// its count/date inputs to the same limits instead of only finding out
// after submitting.
export const SERIES_MAX_OCCURRENCES: Record<SeriesFrequency, number> = {
  daily: 180,
  weekly: 52
}

function computeSeriesDates(startDate: string, recurrence: SeriesRecurrence): string[] {
  const stepDays = recurrence.frequency === 'daily' ? 1 : 7
  const dates: string[] = []
  let d = new Date(`${startDate}T00:00:00`)
  if (recurrence.type === 'count') {
    for (let i = 0; i < recurrence.count; i++) {
      dates.push(formatDateISO(d))
      d = addDays(d, stepDays)
    }
  } else {
    const end = new Date(`${recurrence.endDate}T00:00:00`)
    while (d <= end) {
      dates.push(formatDateISO(d))
      d = addDays(d, stepDays)
    }
  }
  return dates
}

/**
 * Creates a daily- or weekly-recurring series of bookings, same time every
 * day/week. Each occurrence goes through the normal atomic createBooking
 * transaction one at a time — a date that's already taken by someone else
 * is skipped rather than failing the whole series, and every occurrence
 * that IS created keeps its own confirmationCode/cancellationToken so it
 * can still be looked up or cancelled individually (see CancelViaTokenPage
 * / CancelLookupPage). The bookingSeries doc this writes exists only so
 * the whole series can be cancelled with a single link (see
 * cancelBookingSeries).
 */
export async function createBookingSeries(input: CreateSeriesInput): Promise<CreatedSeries> {
  const dates = computeSeriesDates(input.startDate, input.recurrence)
  const maxOccurrences = SERIES_MAX_OCCURRENCES[input.recurrence.frequency]
  if (dates.length === 0) {
    throw new Error('A recurring booking needs at least one occurrence')
  }
  if (dates.length > maxOccurrences) {
    throw new Error(`A ${input.recurrence.frequency} recurring booking can span at most ${maxOccurrences} occurrences`)
  }

  const seriesRef = doc(collection(db, 'bookingSeries'))
  const cancellationToken = generateToken()
  const tokenExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

  const created: SeriesOccurrenceResult[] = []
  const skippedDates: string[] = []

  for (const date of dates) {
    try {
      const booking = await createBooking({
        clubId: input.clubId,
        rinkId: input.rinkId,
        zoneId: input.zoneId,
        date,
        startTime: input.startTime,
        durationMinutes: input.durationMinutes,
        name: input.name,
        email: input.email,
        phone: input.phone,
        timezone: input.timezone,
        seriesId: seriesRef.id,
        attendeeCount: input.attendeeCount
      })
      created.push({ bookingId: booking.id, date, confirmationCode: booking.confirmationCode })
    } catch (err) {
      if (err instanceof SlotUnavailableError) {
        skippedDates.push(date)
      } else {
        throw err
      }
    }
  }

  if (created.length === 0) {
    throw new SlotUnavailableError()
  }

  await setDoc(seriesRef, {
    clubId: input.clubId,
    rinkId: input.rinkId,
    zoneId: input.zoneId,
    frequency: input.recurrence.frequency,
    dayOfWeek: new Date(`${input.startDate}T00:00:00`).getDay(),
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    name: input.name,
    email: input.email,
    phone: input.phone,
    cancellationToken,
    tokenExpiresAt,
    createdAt: serverTimestamp()
  })

  return { seriesId: seriesRef.id, cancellationToken, created, skippedDates }
}

/**
 * All occurrences (any status) belonging to a series, oldest first — used
 * by the series management page and by cancelBookingSeries.
 */
export async function fetchSeriesBookings(seriesId: string): Promise<(Booking & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'bookings'), where('seriesId', '==', seriesId)))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Booking & { id: string })
    .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)))
}

/**
 * Cancels every still-confirmed, not-yet-locked occurrence in a series. Each
 * occurrence is cancelled through the normal single-booking transaction, one
 * at a time — not a single atomic operation across the whole series — so a
 * failure on one occurrence doesn't block the rest from being cancelled. An
 * occurrence inside the CANCELLATION_CUTOFF_HOURS window is left confirmed,
 * same as if the customer had tried to cancel it individually.
 */
export async function cancelBookingSeries(
  seriesId: string,
  timezone: string
): Promise<{ cancelled: number; alreadyCancelled: number; locked: number }> {
  const occurrences = await fetchSeriesBookings(seriesId)
  let cancelled = 0
  let alreadyCancelled = 0
  let locked = 0
  for (const occurrence of occurrences) {
    if (occurrence.status === 'cancelled') {
      alreadyCancelled++
      continue
    }
    if (isPastCancellationCutoff(occurrence.date, occurrence.startTime, timezone)) {
      locked++
      continue
    }
    await cancelBooking(occurrence.id)
    cancelled++
  }
  return { cancelled, alreadyCancelled, locked }
}

/**
 * Admin-only: fixes up who a booking is for, without touching its zone,
 * date/time, or status. Requires the isStaff Firestore rule.
 */
export async function updateBookingContact(
  bookingId: string,
  contact: { name: string; email: string; phone: string }
): Promise<void> {
  await updateDoc(doc(db, 'bookings', bookingId), contact)
}

/**
 * Admin-only: all bookings for a club within an inclusive date range
 * (across every zone), for the admin overview table and Excel export.
 */
export async function fetchBookingsInRange(
  clubId: string,
  startDate: string,
  endDate: string
): Promise<(Booking & { id: string })[]> {
  const snap = await getDocs(
    query(
      collection(db, 'bookings'),
      where('clubId', '==', clubId),
      where('date', '>=', startDate),
      where('date', '<=', endDate),
      orderBy('date', 'asc'),
      orderBy('startTime', 'asc')
    )
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Booking & { id: string })
}
