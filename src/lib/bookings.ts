import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore'
import { db } from './firebase'
import { Zone } from '@/types'
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
 * A zone's `conflictsWith` list (including itself) names every zone that
 * shares physical ice with it. We lock every zone in that list so that,
 * e.g., booking "Half A" also blocks "Full Rink" for the same slot, and
 * booking "Full Rink" is blocked if any half/third is already booked.
 * All reads happen before any writes, as required by Firestore transactions.
 */
export async function createBooking(input: CreateBookingInput): Promise<CreatedBooking> {
  const zoneRef = doc(db, 'zones', input.zoneId)
  const bookingRef = doc(collection(db, 'bookings'))

  return runTransaction(db, async (tx) => {
    const zoneSnap = await tx.get(zoneRef)
    if (!zoneSnap.exists()) {
      throw new Error('Zone not found')
    }
    const zone = zoneSnap.data() as Zone
    const lockedZoneIds = zone.conflictsWith.length > 0 ? zone.conflictsWith : [zone.id]

    const lockRefs = lockedZoneIds.map((zoneId) =>
      doc(db, 'slotLocks', slotLockId(input.clubId, zoneId, input.date, input.startTime))
    )
    const lockSnaps = await Promise.all(lockRefs.map((ref) => tx.get(ref)))

    if (lockSnaps.some((snap) => snap.exists())) {
      throw new SlotUnavailableError()
    }

    const confirmationCode = generateConfirmationCode()
    const cancellationToken = generateToken()
    const tokenExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

    lockRefs.forEach((ref, i) => {
      tx.set(ref, {
        clubId: input.clubId,
        zoneId: lockedZoneIds[i],
        date: input.date,
        startTime: input.startTime,
        bookingId: bookingRef.id,
        createdAt: serverTimestamp()
      })
    })

    tx.set(bookingRef, {
      clubId: input.clubId,
      zoneId: input.zoneId,
      lockedZoneIds,
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
 * Cancels a booking and releases its slot locks so the zone/time becomes
 * bookable again. Releases exactly the locks created at booking time
 * (stored on the booking as `lockedZoneIds`), independent of the zone's
 * current config.
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

    const lockedZoneIds: string[] = booking.lockedZoneIds ?? [booking.zoneId]
    const lockRefs = lockedZoneIds.map((zoneId) =>
      doc(db, 'slotLocks', slotLockId(booking.clubId, zoneId, booking.date, booking.startTime))
    )
    lockRefs.forEach((ref) => tx.delete(ref))

    tx.update(bookingRef, {
      status: 'cancelled',
      cancelledAt: serverTimestamp()
    })
  })
}
