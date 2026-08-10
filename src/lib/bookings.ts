import { collection, doc, getDocs, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import { Booking } from '@/types'
import { addDays, formatDateISO, generateConfirmationCode, generateToken } from './utils'

export class SlotUnavailableError extends Error {
  constructor() {
    super('This zone is no longer available for the selected time.')
    this.name = 'SlotUnavailableError'
  }
}

function slotLockId(clubId: string, zoneId: string, date: string, startTime: string) {
  return `${clubId}__${zoneId}__${date}__${startTime}`
}

/**
 * Returns the set of "zoneId__startTime" pairs that are booked on the given
 * date, for display purposes (e.g. graying out taken slots in the picker).
 * Not used for the actual reservation decision — createBooking re-checks
 * inside a transaction regardless, so this is safe to read outside one.
 */
export async function fetchLockedSlots(clubId: string, date: string): Promise<Set<string>> {
  const snap = await getDocs(
    query(collection(db, 'slotLocks'), where('clubId', '==', clubId), where('date', '==', date))
  )
  return new Set(snap.docs.map((d) => `${d.data().zoneId}__${d.data().startTime}`))
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
    const data = d.data() as { date: string; zoneId: string; startTime: string }
    if (!byDate.has(data.date)) byDate.set(data.date, new Set())
    byDate.get(data.date)!.add(`${data.zoneId}__${data.startTime}`)
  }
  return byDate
}

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
  // Set when this occurrence is part of a recurring series (see
  // createBookingSeries) — omitted for a normal one-off booking.
  seriesId?: string
}

export interface CreatedBooking {
  id: string
  confirmationCode: string
  cancellationToken: string
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
 */
export async function createBooking(input: CreateBookingInput): Promise<CreatedBooking> {
  const lockRef = doc(db, 'slotLocks', slotLockId(input.clubId, input.zoneId, input.date, input.startTime))
  const bookingRef = doc(collection(db, 'bookings'))

  return runTransaction(db, async (tx) => {
    const lockSnap = await tx.get(lockRef)
    if (lockSnap.exists()) {
      throw new SlotUnavailableError()
    }

    const confirmationCode = generateConfirmationCode()
    const cancellationToken = generateToken()
    const tokenExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

    tx.set(lockRef, {
      clubId: input.clubId,
      zoneId: input.zoneId,
      date: input.date,
      startTime: input.startTime,
      bookingId: bookingRef.id,
      createdAt: serverTimestamp()
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
      confirmationCode,
      cancellationToken,
      tokenExpiresAt,
      status: 'confirmed',
      createdAt: serverTimestamp()
    })

    return { id: bookingRef.id, confirmationCode, cancellationToken }
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

export type SeriesRecurrence = { type: 'count'; count: number } | { type: 'until'; endDate: string }

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
  recurrence: SeriesRecurrence
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

// A weekly series realistically never needs to run longer than a year —
// caps a malformed end date (or fat-fingered count) from looping forever.
const MAX_SERIES_OCCURRENCES = 52

function computeSeriesDates(startDate: string, recurrence: SeriesRecurrence): string[] {
  const dates: string[] = []
  let d = new Date(`${startDate}T00:00:00`)
  if (recurrence.type === 'count') {
    for (let i = 0; i < recurrence.count; i++) {
      dates.push(formatDateISO(d))
      d = addDays(d, 7)
    }
  } else {
    const end = new Date(`${recurrence.endDate}T00:00:00`)
    while (d <= end) {
      dates.push(formatDateISO(d))
      d = addDays(d, 7)
    }
  }
  return dates
}

/**
 * Creates a weekly-recurring series of bookings, same day-of-week/time
 * every week. Each occurrence goes through the normal atomic createBooking
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
  if (dates.length === 0) {
    throw new Error('A recurring booking needs at least one occurrence')
  }
  if (dates.length > MAX_SERIES_OCCURRENCES) {
    throw new Error(`A recurring booking can span at most ${MAX_SERIES_OCCURRENCES} weeks`)
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
        seriesId: seriesRef.id
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
 * Cancels every still-confirmed occurrence in a series. Each occurrence is
 * cancelled through the normal single-booking transaction, one at a time —
 * not a single atomic operation across the whole series — so a failure on
 * one occurrence doesn't block the rest from being cancelled.
 */
export async function cancelBookingSeries(seriesId: string): Promise<{ cancelled: number; alreadyCancelled: number }> {
  const occurrences = await fetchSeriesBookings(seriesId)
  let cancelled = 0
  let alreadyCancelled = 0
  for (const occurrence of occurrences) {
    if (occurrence.status === 'cancelled') {
      alreadyCancelled++
      continue
    }
    await cancelBooking(occurrence.id)
    cancelled++
  }
  return { cancelled, alreadyCancelled }
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
