import { collection, deleteDoc, deleteField, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import { FreeIceSlot } from '@/types'

// Staff-curated "free ice available to rent" listing — see FreeIceSlot in
// src/types/index.ts for why this is a separate, plain CRUD collection
// rather than reusing RinkScheduleEntry/bookings.

export interface FreeIceSlotFields {
  rinkId: string
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
    date: fields.date,
    startTime: fields.startTime,
    endTime: fields.endTime,
    note: fields.note ? fields.note : deleteField()
  })
}

export async function deleteFreeIceSlot(id: string): Promise<void> {
  await deleteDoc(doc(db, 'freeIceSlots', id))
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
