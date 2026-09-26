import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import { createBooking, createBookingSeries, cancelBooking, fetchSeriesBookings, SeriesRecurrence } from './bookings'
import { RinkScheduleEntry } from '@/types'

// A staff/trainer schedule of standing team-practice/public-skating
// blocks — see CLAUDE.md's "Rink team schedule" section for the full
// rationale. Every entry always blocks real ice via the exact same
// createBooking/createBookingSeries transaction the customer-facing
// booking flow uses, so it can never silently double-book a zone/time a
// customer (or another entry) already holds — a collision throws the
// same SlotUnavailableError (see lib/bookings.ts) that flow already
// surfaces, and the caller (RinkSchedulePage.tsx) shows it the same way.

export interface CreateRinkScheduleEntryInput {
  clubId: string
  rinkId: string
  zoneId: string
  teamName: string
  room?: string
  createdBy: string
  createdByName: string
  // Synthesized onto the underlying Booking's required email/phone
  // fields, exactly like a tournament match's blocksIce booking already
  // does (see createTournamentMatch) — there's no customer to actually
  // email here.
  createdByEmail: string
  date: string
  startTime: string
  durationMinutes: number
  timezone: string
  // Set to also create a recurring series instead of a single occurrence.
  recurrence?: SeriesRecurrence
}

export async function createRinkScheduleEntry(input: CreateRinkScheduleEntryInput): Promise<string> {
  const entryRef = doc(collection(db, 'rinkScheduleEntries'))
  const base = {
    clubId: input.clubId,
    rinkId: input.rinkId,
    zoneId: input.zoneId,
    teamName: input.teamName,
    ...(input.room ? { room: input.room } : {}),
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    date: input.date,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    createdAt: serverTimestamp()
  }

  if (input.recurrence) {
    const series = await createBookingSeries({
      clubId: input.clubId,
      rinkId: input.rinkId,
      zoneId: input.zoneId,
      startDate: input.date,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes,
      name: input.teamName,
      email: input.createdByEmail,
      phone: '',
      timezone: input.timezone,
      recurrence: input.recurrence
    })
    await setDoc(entryRef, { ...base, seriesId: series.seriesId })
    return entryRef.id
  }

  const booking = await createBooking({
    clubId: input.clubId,
    rinkId: input.rinkId,
    zoneId: input.zoneId,
    date: input.date,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    name: input.teamName,
    email: input.createdByEmail,
    phone: '',
    timezone: input.timezone
  })
  await setDoc(entryRef, { ...base, bookingId: booking.id })
  return entryRef.id
}

export async function fetchRinkScheduleEntries(clubId: string): Promise<(RinkScheduleEntry & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'rinkScheduleEntries'), where('clubId', '==', clubId)))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as RinkScheduleEntry & { id: string })
    .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)))
}

/**
 * Cancels every real Booking this entry created (bypassing the customer
 * self-cancel cutoff — this is a staff action on staff's own schedule
 * entry, same "staff are exempt" stance CLAUDE.md's Cancellation lockdown
 * section already documents for cancelBooking itself), then removes the
 * entry doc.
 */
export async function deleteRinkScheduleEntry(entry: RinkScheduleEntry & { id: string }): Promise<void> {
  if (entry.seriesId) {
    const bookings = await fetchSeriesBookings(entry.seriesId)
    await Promise.all(bookings.filter((b) => b.status !== 'cancelled').map((b) => cancelBooking(b.id).catch(() => {})))
  } else if (entry.bookingId) {
    await cancelBooking(entry.bookingId).catch(() => {})
  }
  await deleteDoc(doc(db, 'rinkScheduleEntries', entry.id))
}
