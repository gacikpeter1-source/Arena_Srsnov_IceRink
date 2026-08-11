import { DivisionRule, ScheduleOverride, TimeSlotConfig, Zone } from '@/types'
import { minutesToTime, timeToMinutes } from './utils'
import { resolveDivisionMode } from './divisionRules'

export interface ScheduleRow {
  time: string
  durationMinutes: number
  zones: Zone[]
}

/**
 * All open time slots for a given day, each paired with its own duration
 * and the zone(s) actually offered at that time (per the admin's
 * division-mode schedule — see resolveDivisionMode). Shared by the public
 * booking page, the admin "create reservation" form, and the admin QR-code
 * panel so they can never drift out of sync with each other.
 *
 * If `override` is given (a ScheduleOverride for this exact rink+date), its
 * explicit slot list is used as-is — a hand-adjusted one-off day. Otherwise
 * slots are generated from the recurring TimeSlotConfig, spaced by
 * `slotDurationMinutes + breakMinutes` (default 0 if breakMinutes is unset)
 * so there's a cleaning/prep gap between sessions that customers never see
 * directly — only each session's own start-end shows.
 */
export function computeDaySchedule(
  date: Date,
  timeSlotConfig: TimeSlotConfig,
  divisionRules: DivisionRule[],
  zones: Zone[],
  override?: ScheduleOverride | null
): ScheduleRow[] {
  const dayOfWeek = date.getDay()

  if (override) {
    return override.slots.map(({ startTime, durationMinutes }) => ({
      time: startTime,
      durationMinutes,
      zones: zones.filter((z) => z.mode === resolveDivisionMode(divisionRules, dayOfWeek, startTime))
    }))
  }

  const dayHours = timeSlotConfig.hours.find((h) => h.dayOfWeek === dayOfWeek)
  if (!dayHours) return []

  const openMin = timeToMinutes(dayHours.openTime)
  const closeMin = timeToMinutes(dayHours.closeTime)
  const step = timeSlotConfig.slotDurationMinutes + (timeSlotConfig.breakMinutes ?? 0)
  const rows: ScheduleRow[] = []

  for (let m = openMin; m + timeSlotConfig.slotDurationMinutes <= closeMin; m += step) {
    const time = minutesToTime(m)
    const mode = resolveDivisionMode(divisionRules, dayOfWeek, time)
    rows.push({ time, durationMinutes: timeSlotConfig.slotDurationMinutes, zones: zones.filter((z) => z.mode === mode) })
  }
  return rows
}
