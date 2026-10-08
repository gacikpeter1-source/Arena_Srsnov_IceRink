import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import {
  createBooking,
  createBookingSeries,
  cancelBooking,
  fetchSeriesBookings,
  computeSeriesDates,
  SeriesRecurrence,
  SlotUnavailableError
} from './bookings'
import { generateToken } from './utils'
import { Booking, RinkScheduleEntry, SeriesFrequency } from '@/types'

// A staff/trainer schedule of standing team-practice/public-skating
// blocks — see CLAUDE.md's "Rink team schedule" section for the full
// rationale. Every ordinary entry always blocks real ice via the exact
// same createBooking/createBookingSeries transaction the customer-facing
// booking flow uses, so it can never silently double-book a zone/time a
// customer (or another entry) already holds — a collision throws the
// same SlotUnavailableError (see lib/bookings.ts) that flow already
// surfaces, and the caller (RinkSchedulePage.tsx) shows it the same way.
// The one deliberate exception is an `isInformational` entry (see its own
// doc comment on the type) — created with `informational: true` below,
// which skips createBooking/the conflict check entirely so staff can
// write a planning note onto an already-full day/time without it
// colliding with anything.

// How many real future occurrences a `repeatForever` entry keeps alive at
// once — kept in sync with functions/src/index.ts's own copy of this
// constant (topUpForeverRinkScheduleEntries, which is what actually
// sustains the window week over week; this constant only governs the
// *initial* window created here).
export const RINK_SCHEDULE_FOREVER_WINDOW = 8

export interface CreateRinkScheduleEntryInput {
  clubId: string
  rinkId: string
  zoneId: string
  teamName: string
  room?: string
  awayRoom?: string
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
  // Set to also create a recurring series instead of a single occurrence
  // — mutually exclusive with repeatForeverFrequency below.
  recurrence?: SeriesRecurrence
  // Set instead of `recurrence` for a daily/weekly repeat with no end at
  // all — see RinkScheduleEntry.repeatForever's own doc comment.
  repeatForeverFrequency?: SeriesFrequency
  // See RinkScheduleEntry.isInformational's own doc comment — when set,
  // this entry is written directly with no createBooking call at all (so
  // no conflict check, no slot lock, nothing for `recurrence`/
  // `repeatForeverFrequency` above to even apply to; the caller is
  // expected not to set either alongside this).
  informational?: boolean
}

export async function createRinkScheduleEntry(input: CreateRinkScheduleEntryInput): Promise<string> {
  const entryRef = doc(collection(db, 'rinkScheduleEntries'))
  const base = {
    clubId: input.clubId,
    rinkId: input.rinkId,
    zoneId: input.zoneId,
    teamName: input.teamName,
    ...(input.room ? { room: input.room } : {}),
    ...(input.awayRoom ? { awayRoom: input.awayRoom } : {}),
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    date: input.date,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    createdAt: serverTimestamp()
  }

  if (input.informational) {
    await setDoc(entryRef, { ...base, isInformational: true })
    return entryRef.id
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

  if (input.repeatForeverFrequency) {
    // No BookingSeries doc — there's no fixed count/end date to describe,
    // and nothing here reads one back (fetchRinkScheduleOccurrences below
    // always re-queries real Booking docs by seriesId directly). Loop the
    // same way createBookingSeries does: one createBooking call per date,
    // skipping (not failing on) a date someone else already has.
    const seriesId = doc(collection(db, 'rinkScheduleEntries')).id
    const dates = computeSeriesDates(input.date, {
      type: 'count',
      frequency: input.repeatForeverFrequency,
      count: RINK_SCHEDULE_FOREVER_WINDOW
    })
    for (const date of dates) {
      try {
        await createBooking({
          clubId: input.clubId,
          rinkId: input.rinkId,
          zoneId: input.zoneId,
          date,
          startTime: input.startTime,
          durationMinutes: input.durationMinutes,
          name: input.teamName,
          email: input.createdByEmail,
          phone: '',
          timezone: input.timezone,
          seriesId
        })
      } catch (err) {
        if (!(err instanceof SlotUnavailableError)) throw err
      }
    }
    await setDoc(entryRef, { ...base, seriesId, repeatForever: true, frequency: input.repeatForeverFrequency })
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

export interface RinkScheduleOccurrenceFields {
  rinkId: string
  zoneId: string
  date: string
  startTime: string
  durationMinutes: number
  teamName: string
  room?: string
  awayRoom?: string
  timezone: string
}

/**
 * Every real occurrence behind an entry, for display/edit — a single
 * (non-recurring) entry has exactly one, a recurring one as many as
 * fetchSeriesBookings finds. Deliberately reads the live Booking docs
 * (date/startTime/rinkId/zoneId/name), not the entry's own copies of
 * those fields, which only ever describe the series' *original* first
 * slot — rescheduleRinkScheduleOccurrence moves individual occurrences
 * without touching the entry doc at all, so the entry's own fields go
 * stale the moment any occurrence is edited. Cancelled occurrences are
 * left out, same as the schedule board already does.
 */
export async function fetchRinkScheduleOccurrences(
  entry: RinkScheduleEntry & { id: string }
): Promise<(Booking & { id: string })[]> {
  if (entry.seriesId) {
    const bookings = await fetchSeriesBookings(entry.seriesId)
    return bookings.filter((b) => b.status !== 'cancelled')
  }
  if (entry.bookingId) {
    const snap = await getDoc(doc(db, 'bookings', entry.bookingId))
    if (!snap.exists()) return []
    const booking = { id: snap.id, ...snap.data() } as Booking & { id: string }
    return booking.status === 'cancelled' ? [] : [booking]
  }
  return []
}

/**
 * Moves a single (non-recurring) entry's own booking to a new rink/zone/
 * date/time/duration/team/room, or just edits those fields in place when
 * the zone/date/time didn't actually change (see below). Propagates
 * SlotUnavailableError from createBooking untouched — same conflict-
 * detection/replace UX (lib/rinkConflicts.ts) the create form already
 * uses is expected to run before calling this.
 */
export async function rescheduleRinkScheduleEntry(
  entry: RinkScheduleEntry & { id: string },
  fields: RinkScheduleOccurrenceFields
): Promise<void> {
  if (!entry.bookingId) throw new Error('This entry has no single booking to reschedule')
  const bookingRef = doc(db, 'bookings', entry.bookingId)
  const oldSnap = await getDoc(bookingRef)
  const oldBooking = oldSnap.exists() ? (oldSnap.data() as Booking) : null

  // Same zone/date/time as before means the real slot lock never needs to
  // move — just patch the booking's own display fields in place. Trying
  // to createBooking "into" the exact slot the old booking already holds
  // would otherwise throw SlotUnavailableError against itself, since
  // nothing was cancelled yet.
  const sameSlot =
    oldBooking != null &&
    oldBooking.zoneId === fields.zoneId &&
    oldBooking.date === fields.date &&
    oldBooking.startTime === fields.startTime

  let newBookingId = entry.bookingId
  if (sameSlot) {
    await updateDoc(bookingRef, { name: fields.teamName, rinkId: fields.rinkId, durationMinutes: fields.durationMinutes })
  } else {
    const created = await createBooking({
      clubId: entry.clubId,
      rinkId: fields.rinkId,
      zoneId: fields.zoneId,
      date: fields.date,
      startTime: fields.startTime,
      durationMinutes: fields.durationMinutes,
      name: fields.teamName,
      email: oldBooking?.email ?? '',
      phone: oldBooking?.phone ?? '',
      timezone: fields.timezone
    })
    // Only release the old slot once the new one is confirmed held — if
    // createBooking throws (slot taken), the team keeps its original ice
    // rather than ending up with neither.
    await cancelBooking(entry.bookingId).catch(() => {})
    newBookingId = created.id
  }

  await updateDoc(doc(db, 'rinkScheduleEntries', entry.id), {
    rinkId: fields.rinkId,
    zoneId: fields.zoneId,
    date: fields.date,
    startTime: fields.startTime,
    durationMinutes: fields.durationMinutes,
    teamName: fields.teamName,
    bookingId: newBookingId,
    ...(fields.room ? { room: fields.room } : {}),
    ...(fields.awayRoom ? { awayRoom: fields.awayRoom } : {})
  })
}

/**
 * Moves one occurrence of a recurring entry's series to a new rink/zone/
 * date/time/duration/team/room, leaving every other occurrence and the
 * entry doc's own (creation-time) fields untouched — the entry doc never
 * describes any single occurrence once a series has more than one, only
 * how it was first set up (see fetchRinkScheduleOccurrences). A same-slot
 * edit (only the team name or room changed) patches the existing booking
 * in place, same reasoning as rescheduleRinkScheduleEntry.
 */
export async function rescheduleRinkScheduleOccurrence(
  entry: RinkScheduleEntry & { id: string },
  oldBookingId: string,
  fields: RinkScheduleOccurrenceFields
): Promise<void> {
  const bookingRef = doc(db, 'bookings', oldBookingId)
  const oldSnap = await getDoc(bookingRef)
  const oldBooking = oldSnap.exists() ? (oldSnap.data() as Booking) : null

  const sameSlot =
    oldBooking != null &&
    oldBooking.zoneId === fields.zoneId &&
    oldBooking.date === fields.date &&
    oldBooking.startTime === fields.startTime

  let newBookingId = oldBookingId
  if (sameSlot) {
    await updateDoc(bookingRef, { name: fields.teamName, rinkId: fields.rinkId, durationMinutes: fields.durationMinutes })
  } else {
    const created = await createBooking({
      clubId: entry.clubId,
      rinkId: fields.rinkId,
      zoneId: fields.zoneId,
      date: fields.date,
      startTime: fields.startTime,
      durationMinutes: fields.durationMinutes,
      name: fields.teamName,
      email: oldBooking?.email ?? '',
      phone: oldBooking?.phone ?? '',
      timezone: fields.timezone,
      ...(entry.seriesId ? { seriesId: entry.seriesId } : {})
    })
    await cancelBooking(oldBookingId).catch(() => {})
    newBookingId = created.id
  }

  const entryUpdates: { occurrenceRooms?: Record<string, string>; occurrenceAwayRooms?: Record<string, string> } = {}
  if (fields.room) {
    const occurrenceRooms = { ...entry.occurrenceRooms }
    delete occurrenceRooms[oldBookingId]
    occurrenceRooms[newBookingId] = fields.room
    entryUpdates.occurrenceRooms = occurrenceRooms
  }
  if (fields.awayRoom) {
    const occurrenceAwayRooms = { ...entry.occurrenceAwayRooms }
    delete occurrenceAwayRooms[oldBookingId]
    occurrenceAwayRooms[newBookingId] = fields.awayRoom
    entryUpdates.occurrenceAwayRooms = occurrenceAwayRooms
  }
  if (Object.keys(entryUpdates).length > 0) {
    await updateDoc(doc(db, 'rinkScheduleEntries', entry.id), entryUpdates)
  }
}

// Weekly default used by "Opakovať" on RinkSchedulePage.tsx's entries
// table — a quick, no-extra-input way to turn an already-created single
// entry into a recurring one, mirroring the same frequency/count the
// create form's own "Repeat this booking" checkbox defaults to.
export const RINK_SCHEDULE_QUICK_REPEAT: SeriesRecurrence = { type: 'count', frequency: 'weekly', count: 8 }

/**
 * Converts an existing single (non-recurring) entry into a recurring
 * series, keeping its already-existing booking as occurrence 1 rather than
 * recreating it — calling createBookingSeries directly from this entry's
 * own date would try to create a brand-new booking for that exact slot too
 * and silently skip it as already taken (see computeSeriesDates' own doc
 * comment), losing the original occurrence from the result. Every later
 * date is created the same way createBookingSeries creates its own
 * occurrences: one at a time through the normal createBooking transaction,
 * skipping (not failing on) a date someone else already has. A matching
 * `bookingSeries` doc is written so this series looks identical to one
 * created the normal way to any other code that reads that collection.
 */
export async function startRinkScheduleEntryRepeat(
  entry: RinkScheduleEntry & { id: string },
  timezone: string,
  recurrence: SeriesRecurrence = RINK_SCHEDULE_QUICK_REPEAT
): Promise<void> {
  if (!entry.bookingId) throw new Error('This entry is already recurring')
  const bookingRef = doc(db, 'bookings', entry.bookingId)
  const bookingSnap = await getDoc(bookingRef)
  if (!bookingSnap.exists()) throw new Error('This entry has no booking to repeat')
  const booking = bookingSnap.data() as Booking

  const dates = computeSeriesDates(entry.date, recurrence)
  const seriesRef = doc(collection(db, 'bookingSeries'))

  await updateDoc(bookingRef, { seriesId: seriesRef.id })

  for (const date of dates.slice(1)) {
    try {
      await createBooking({
        clubId: entry.clubId,
        rinkId: entry.rinkId,
        zoneId: entry.zoneId,
        date,
        startTime: entry.startTime,
        durationMinutes: entry.durationMinutes,
        name: entry.teamName,
        email: booking.email,
        phone: booking.phone,
        timezone,
        seriesId: seriesRef.id
      })
    } catch (err) {
      if (!(err instanceof SlotUnavailableError)) throw err
    }
  }

  await setDoc(seriesRef, {
    clubId: entry.clubId,
    rinkId: entry.rinkId,
    zoneId: entry.zoneId,
    frequency: recurrence.frequency,
    dayOfWeek: new Date(`${entry.date}T00:00:00`).getDay(),
    startTime: entry.startTime,
    durationMinutes: entry.durationMinutes,
    name: entry.teamName,
    email: booking.email,
    phone: booking.phone,
    cancellationToken: generateToken(),
    tokenExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    createdAt: serverTimestamp()
  })

  await updateDoc(doc(db, 'rinkScheduleEntries', entry.id), {
    bookingId: deleteField(),
    seriesId: seriesRef.id
  })
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
