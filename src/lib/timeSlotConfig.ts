import { doc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import { DayHours } from '@/types'

export interface TimeSlotConfigUpdate {
  slotDurationMinutes: number
  breakMinutes: number
  hours: DayHours[]
}

/**
 * Owner/assistant self-service for a rink's recurring default schedule
 * (session length, cleaning/prep break between sessions, and which
 * day-of-week + open/close hours it runs) — same isStaffMember Firestore
 * rule as everything else schedule-related. Previously this collection was
 * only ever written once by scripts/seed.mjs.
 */
export async function updateTimeSlotConfig(configId: string, update: TimeSlotConfigUpdate): Promise<void> {
  await updateDoc(doc(db, 'timeSlotConfig', configId), {
    slotDurationMinutes: update.slotDurationMinutes,
    breakMinutes: update.breakMinutes,
    hours: update.hours
  })
}
