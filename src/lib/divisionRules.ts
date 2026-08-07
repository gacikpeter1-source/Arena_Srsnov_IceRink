import { DivisionMode, DivisionRule } from '@/types'
import { timeToMinutes } from './utils'

/**
 * Resolves which division mode is offered for a given day-of-week + time,
 * per the admin's recurring schedule. Falls back to 'full' (whole rink)
 * when no rule covers that window. If rules overlap, the first match wins
 * — admins are expected not to create overlapping windows.
 */
export function resolveDivisionMode(
  rules: DivisionRule[],
  dayOfWeek: number,
  startTime: string
): DivisionMode {
  const minutes = timeToMinutes(startTime)
  const match = rules.find(
    (rule) =>
      rule.dayOfWeek === dayOfWeek &&
      minutes >= timeToMinutes(rule.startTime) &&
      minutes < timeToMinutes(rule.endTime)
  )
  return match?.mode ?? 'full'
}
