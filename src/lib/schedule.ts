import { DivisionRule, TimeSlotConfig, Zone } from '@/types'
import { minutesToTime, timeToMinutes } from './utils'
import { resolveDivisionMode } from './divisionRules'

export interface ScheduleRow {
  time: string
  zones: Zone[]
}

/**
 * All open time slots for a given day, each paired with the zone(s)
 * actually offered at that time (per the admin's division-mode schedule —
 * see resolveDivisionMode). Shared by the public booking page, the admin
 * "create reservation" form, and the admin QR-code panel so they can never
 * drift out of sync with each other.
 */
export function computeDaySchedule(
  date: Date,
  timeSlotConfig: TimeSlotConfig,
  divisionRules: DivisionRule[],
  zones: Zone[]
): ScheduleRow[] {
  const dayOfWeek = date.getDay()
  const dayHours = timeSlotConfig.hours.find((h) => h.dayOfWeek === dayOfWeek)
  if (!dayHours) return []

  const openMin = timeToMinutes(dayHours.openTime)
  const closeMin = timeToMinutes(dayHours.closeTime)
  const rows: ScheduleRow[] = []

  for (let m = openMin; m + timeSlotConfig.slotDurationMinutes <= closeMin; m += timeSlotConfig.slotDurationMinutes) {
    const time = minutesToTime(m)
    const mode = resolveDivisionMode(divisionRules, dayOfWeek, time)
    rows.push({ time, zones: zones.filter((z) => z.mode === mode) })
  }
  return rows
}
