import { ScheduleOverride, TimeSlotConfig, Zone } from '@/types'
import { minutesToTime, timeToMinutes } from './utils'

export interface ScheduleRow {
  time: string
  durationMinutes: number
  zones: Zone[]
}

/**
 * All open time slots for a given day, each paired with its own duration
 * and the zone(s) actually offered at that time. Shared by the public
 * booking page, the admin "create reservation" form, and the admin QR-code
 * panel so they can never drift out of sync with each other.
 *
 * The standing default is the whole rink ('full') — a session only offers
 * a split (half/third/halfLengthwise) when staff explicitly set that
 * session's `mode` via a ScheduleOverride (see AdminDaySchedulePanel).
 * There's no recurring day-of-week rule for this any more: that used to
 * pick a mode per weekly window independently of what was actually booked,
 * which could show a zone as available even while a different-mode zone
 * covering the same physical ice was already taken. Tying mode directly to
 * the per-date slot list removes that gap.
 *
 * If `override` is given (a ScheduleOverride for this exact rink+date), its
 * explicit slot list is used as-is — a hand-adjusted one-off day, each slot
 * carrying its own mode (defaulting to 'full' when unset). Otherwise slots
 * are generated from the recurring TimeSlotConfig, spaced by
 * `slotDurationMinutes + breakMinutes` (default 0 if breakMinutes is unset)
 * so there's a cleaning/prep gap between sessions that customers never see
 * directly — only each session's own start-end shows — and every generated
 * slot offers the whole rink.
 */
export function computeDaySchedule(
  date: Date,
  timeSlotConfig: TimeSlotConfig,
  zones: Zone[],
  override?: ScheduleOverride | null
): ScheduleRow[] {
  if (override) {
    return override.slots.map(({ startTime, durationMinutes, mode }) => ({
      time: startTime,
      durationMinutes,
      zones: zones.filter((z) => z.mode === (mode ?? 'full'))
    }))
  }

  const dayOfWeek = date.getDay()
  const dayHours = timeSlotConfig.hours.find((h) => h.dayOfWeek === dayOfWeek)
  if (!dayHours) return []

  const openMin = timeToMinutes(dayHours.openTime)
  const closeMin = timeToMinutes(dayHours.closeTime)
  const step = timeSlotConfig.slotDurationMinutes + (timeSlotConfig.breakMinutes ?? 0)
  const rows: ScheduleRow[] = []

  for (let m = openMin; m + timeSlotConfig.slotDurationMinutes <= closeMin; m += step) {
    const time = minutesToTime(m)
    rows.push({ time, durationMinutes: timeSlotConfig.slotDurationMinutes, zones: zones.filter((z) => z.mode === 'full') })
  }
  return rows
}
