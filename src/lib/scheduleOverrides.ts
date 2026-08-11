import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import { ScheduleOverride } from '@/types'
import { minutesToTime, timeToMinutes } from './utils'

export type ScheduleSlot = { startTime: string; durationMinutes: number }

function overrideId(clubId: string, rinkId: string, date: string) {
  return `${clubId}__${rinkId}__${date}`
}

/** The hand-adjusted schedule for one rink+date, or null if that day still uses the default. */
export async function fetchScheduleOverride(clubId: string, rinkId: string, date: string): Promise<ScheduleOverride | null> {
  const snap = await getDoc(doc(db, 'scheduleOverrides', overrideId(clubId, rinkId, date)))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as ScheduleOverride) : null
}

/** Same as fetchScheduleOverride but across an inclusive date range, keyed by date — powers the public calendar and week grid. */
export async function fetchScheduleOverridesRange(
  clubId: string,
  rinkId: string,
  startDate: string,
  endDate: string
): Promise<Map<string, ScheduleOverride>> {
  const snap = await getDocs(
    query(
      collection(db, 'scheduleOverrides'),
      where('clubId', '==', clubId),
      where('rinkId', '==', rinkId),
      where('date', '>=', startDate),
      where('date', '<=', endDate)
    )
  )
  const byDate = new Map<string, ScheduleOverride>()
  for (const d of snap.docs) {
    const data = d.data() as Omit<ScheduleOverride, 'id'>
    byDate.set(data.date, { id: d.id, ...data })
  }
  return byDate
}

/** Full replace of one rink+date's schedule — used by both the manual day editor and the Excel import. */
export async function saveScheduleOverride(clubId: string, rinkId: string, date: string, slots: ScheduleSlot[]): Promise<void> {
  await setDoc(doc(db, 'scheduleOverrides', overrideId(clubId, rinkId, date)), {
    clubId,
    rinkId,
    date,
    slots,
    updatedAt: serverTimestamp()
  })
}

/** Reverts a rink+date back to the recurring default schedule. */
export async function deleteScheduleOverride(clubId: string, rinkId: string, date: string): Promise<void> {
  await deleteDoc(doc(db, 'scheduleOverrides', overrideId(clubId, rinkId, date)))
}

/**
 * Applies an edit (a new start time and/or duration) at `fromIndex` and
 * re-flows every slot after it back to the club's default rhythm
 * (defaultDurationMinutes + breakMinutes) — matches the stated policy that
 * changing one session's length reschedules everything following it for
 * that day, rather than trying to preserve whatever custom durations those
 * later slots happened to have before. Slots before fromIndex are
 * untouched.
 */
export function cascadeSlotEdit(
  slots: ScheduleSlot[],
  fromIndex: number,
  edited: ScheduleSlot,
  defaultDurationMinutes: number,
  breakMinutes: number
): ScheduleSlot[] {
  const result = slots.slice(0, fromIndex)
  result.push(edited)
  let cursor = timeToMinutes(edited.startTime) + edited.durationMinutes + breakMinutes
  for (let i = fromIndex + 1; i < slots.length; i++) {
    result.push({ startTime: minutesToTime(cursor), durationMinutes: defaultDurationMinutes })
    cursor += defaultDurationMinutes + breakMinutes
  }
  return result
}

/** Appends one more slot at the end, spaced from the last slot by the club's default rhythm. */
export function appendDefaultSlot(slots: ScheduleSlot[], defaultDurationMinutes: number, breakMinutes: number): ScheduleSlot[] {
  const last = slots[slots.length - 1]
  const startMin = last ? timeToMinutes(last.startTime) + last.durationMinutes + breakMinutes : 8 * 60
  return [...slots, { startTime: minutesToTime(startMin), durationMinutes: defaultDurationMinutes }]
}
