import { collection, deleteDoc, deleteField, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { FreeIceSlot } from '@/types'
import { addDays, formatDateISO } from './utils'

// Kept in sync with functions/src/index.ts's own copy of this constant
// (rollFreeIceSlotSeries) — both sides need to agree on how many
// occurrences a "repeating" series keeps alive in the future.
export const FREE_ICE_REPEAT_OCCURRENCES = 4
const FREE_ICE_REPEAT_INTERVAL_DAYS = 7

// Staff-curated "free ice available to rent" listing — see FreeIceSlot in
// src/types/index.ts for why this is a separate, plain CRUD collection
// rather than reusing RinkScheduleEntry/bookings, and for why it now also
// carries a real `zoneId` (the public /book page sources its availability
// straight from this collection).

export interface FreeIceSlotFields {
  rinkId: string
  zoneId: string
  date: string
  startTime: string
  endTime: string
  note?: string
}

export async function createFreeIceSlot(
  input: FreeIceSlotFields & { clubId: string; createdBy: string; createdByName: string }
): Promise<string> {
  const ref = doc(collection(db, 'freeIceSlots'))
  await setDoc(ref, {
    clubId: input.clubId,
    rinkId: input.rinkId,
    zoneId: input.zoneId,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    ...(input.note ? { note: input.note } : {}),
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    createdAt: serverTimestamp()
  })
  return ref.id
}

export async function updateFreeIceSlot(id: string, fields: FreeIceSlotFields): Promise<void> {
  await updateDoc(doc(db, 'freeIceSlots', id), {
    rinkId: fields.rinkId,
    zoneId: fields.zoneId,
    date: fields.date,
    startTime: fields.startTime,
    endTime: fields.endTime,
    note: fields.note ? fields.note : deleteField()
  })
}

export async function deleteFreeIceSlot(id: string): Promise<void> {
  await deleteDoc(doc(db, 'freeIceSlots', id))
}

// Turns an existing one-off slot into occurrence 1 of a new weekly-repeating
// series: FREE_ICE_REPEAT_OCCURRENCES - 1 sibling docs are created at
// +7/+14/... days, all sharing a freshly-minted seriesId, and the slot
// itself is stamped with the same seriesId. From here, rollFreeIceSlotSeries
// (functions/src/index.ts) is what actually keeps the series alive week
// over week — this call only ever establishes the initial window.
export async function startFreeIceSlotRepeat(slot: FreeIceSlot & { id: string }): Promise<void> {
  const seriesId = doc(collection(db, 'freeIceSlots')).id
  const batch = writeBatch(db)
  batch.update(doc(db, 'freeIceSlots', slot.id), { repeatWeekly: true, seriesId })
  const baseDate = new Date(`${slot.date}T00:00:00`)
  for (let i = 1; i < FREE_ICE_REPEAT_OCCURRENCES; i++) {
    const occurrenceDate = formatDateISO(addDays(baseDate, i * FREE_ICE_REPEAT_INTERVAL_DAYS))
    const ref = doc(collection(db, 'freeIceSlots'))
    batch.set(ref, {
      clubId: slot.clubId,
      rinkId: slot.rinkId,
      zoneId: slot.zoneId,
      date: occurrenceDate,
      startTime: slot.startTime,
      endTime: slot.endTime,
      ...(slot.note ? { note: slot.note } : {}),
      createdBy: slot.createdBy,
      createdByName: slot.createdByName,
      createdAt: serverTimestamp(),
      repeatWeekly: true,
      seriesId
    })
  }
  await batch.commit()
}

// Stops a repeating series. Per explicit product confirmation, "cancel"
// really means cancel: every occurrence dated today or later that ISN'T
// already booked is deleted outright, so it stops being offered on /book
// and the TV boards immediately. An already-booked future occurrence can't
// be un-rented by this action (the real Booking is a separate doc,
// untouched either way) — it's instead demoted to a plain one-off slot
// (repeatWeekly/seriesId stripped) so rollFreeIceSlotSeries simply stops
// tracking it as part of a live series, rather than deleting a slot a
// customer is relying on. Past occurrences are left alone — once
// repeatWeekly is gone nothing rolls them forward any more, so there's
// nothing left to decide about them. `bookedKeys` is the caller's own
// already-fetched set of `${rinkId}__${zoneId}__${date}__${startTime}`
// keys for real (confirmed/pending) bookings, reused rather than this
// function re-querying `bookings` itself.
export async function cancelFreeIceSlotRepeat(
  clubId: string,
  seriesId: string,
  bookedKeys: Set<string>
): Promise<void> {
  const today = formatDateISO(new Date())
  const snap = await getDocs(
    query(collection(db, 'freeIceSlots'), where('clubId', '==', clubId), where('seriesId', '==', seriesId))
  )
  const batch = writeBatch(db)
  for (const d of snap.docs) {
    const slot = { id: d.id, ...d.data() } as FreeIceSlot & { id: string }
    if (slot.date < today) continue
    const key = `${slot.rinkId}__${slot.zoneId}__${slot.date}__${slot.startTime}`
    if (bookedKeys.has(key)) {
      batch.update(d.ref, { repeatWeekly: deleteField(), seriesId: deleteField() })
    } else {
      batch.delete(d.ref)
    }
  }
  await batch.commit()
}

export async function fetchFreeIceSlots(clubId: string): Promise<(FreeIceSlot & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'freeIceSlots'), where('clubId', '==', clubId)))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as FreeIceSlot & { id: string })
    .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)))
}

// Upcoming only (today or later) — the public board only ever wants to
// advertise future rental opportunities, not stale past slots.
export async function fetchUpcomingFreeIceSlots(clubId: string, fromDate: string): Promise<(FreeIceSlot & { id: string })[]> {
  const slots = await fetchFreeIceSlots(clubId)
  return slots.filter((s) => s.date >= fromDate)
}

// Ranged fetch for BookingPage.tsx's visible 14-day window — same
// clubId+date>=/<= shape as fetchLockedSlotsRange/fetchBookingsInRange,
// backed by a matching composite index (firestore.indexes.json).
export async function fetchFreeIceSlotsRange(
  clubId: string,
  startDate: string,
  endDate: string
): Promise<(FreeIceSlot & { id: string })[]> {
  const snap = await getDocs(
    query(
      collection(db, 'freeIceSlots'),
      where('clubId', '==', clubId),
      where('date', '>=', startDate),
      where('date', '<=', endDate)
    )
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FreeIceSlot & { id: string })
}
