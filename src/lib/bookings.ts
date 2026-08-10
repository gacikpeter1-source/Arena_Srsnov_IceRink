import { collection, doc, getDocs, orderBy, query, runTransaction, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import { Booking } from '@/types'
import { generateConfirmationCode, generateToken } from './utils'

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
