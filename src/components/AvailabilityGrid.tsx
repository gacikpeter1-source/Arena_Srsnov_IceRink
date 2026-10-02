import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScheduleRow } from '@/lib/schedule'
import { formatDateISO } from '@/lib/utils'

interface AvailabilityGridProps {
  days: Date[]
  rowsByDate: Map<string, ScheduleRow[]>
  lockedSlotsByDate: Map<string, Set<string>>
  onSelectDate: (date: string) => void
}

type CellStatus = 'closed' | 'open' | 'full'

/**
 * A times × days heatmap for one rink — an alternate, at-a-glance view of
 * the same underlying schedule the day-by-day list shows. A cell is
 * "open" if at least one zone offered at that time/date is still free,
 * "full" if every zone offered then is taken, "closed" if the rink isn't
 * offering anything at that time on that day. Clicking an open cell jumps
 * the day-by-day list to that date so the customer can pick the exact
 * zone.
 *
 * Takes the day's rows pre-computed by the caller (`rowsByDate`) rather
 * than a TimeSlotConfig/ScheduleOverride to generate them from — BookingPage
 * already has to compute the exact same rows for its own list view, and
 * since that source switched to FreeIceSlot-only (see CLAUDE.md's "Free
 * ice import becomes the public booking source" note), there's no reason
 * for this component to duplicate that logic a second way.
 */
export default function AvailabilityGrid({ days, rowsByDate, lockedSlotsByDate, onSelectDate }: AvailabilityGridProps) {
  const { t, i18n } = useTranslation()

  const { times, cellStatus } = useMemo(() => {
    const timeSet = new Set<string>()
    for (const day of days) {
      const dISO = formatDateISO(day)
      for (const row of rowsByDate.get(dISO) ?? []) timeSet.add(row.time)
    }
    const times = Array.from(timeSet).sort()

    const cellStatus = new Map<string, CellStatus>() // key: `${time}__${dateISO}`
    for (const day of days) {
      const dISO = formatDateISO(day)
      const rowByTime = new Map((rowsByDate.get(dISO) ?? []).map((r) => [r.time, r]))
      const lockedForDay = lockedSlotsByDate.get(dISO) ?? new Set<string>()
      for (const time of times) {
        const row = rowByTime.get(time)
        if (!row || row.zones.length === 0) {
          cellStatus.set(`${time}__${dISO}`, 'closed')
          continue
        }
        const occupied = row.zones.filter((z) => lockedForDay.has(`${z.id}__${time}`)).length
        cellStatus.set(`${time}__${dISO}`, occupied >= row.zones.length ? 'full' : 'open')
      }
    }
    return { times, cellStatus }
  }, [days, rowsByDate, lockedSlotsByDate])

  const statusClass: Record<CellStatus, string> = {
    closed: 'bg-background-dark',
    open: 'bg-status-success/70 hover:bg-status-success cursor-pointer',
    full: 'bg-status-danger/70'
  }
  const statusLabel: Record<CellStatus, string | undefined> = {
    closed: undefined,
    open: t('home.availabilityOpen'),
    full: t('home.availabilityFull')
  }

  if (times.length === 0) {
    return <p className="text-text-muted text-sm">{t('home.closedToday')}</p>
  }

  return (
    <div className="overflow-x-auto custom-scrollbar">
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-background-card px-2 py-1" />
            {days.map((day) => (
              <th key={day.toISOString()} className="px-1 py-1 font-normal text-text-muted whitespace-nowrap">
                <div>{day.toLocaleDateString(i18n.language, { weekday: 'short' })}</div>
                <div>{day.getDate()}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times.map((time) => (
            <tr key={time}>
              <td className="sticky left-0 z-10 bg-background-card px-2 py-1 mono text-text-muted whitespace-nowrap">
                {time}
              </td>
              {days.map((day) => {
                const dISO = formatDateISO(day)
                const status = cellStatus.get(`${time}__${dISO}`) ?? 'closed'
                return (
                  <td key={dISO} className="p-0.5">
                    <button
                      type="button"
                      disabled={status !== 'open'}
                      onClick={() => onSelectDate(dISO)}
                      title={statusLabel[status]}
                      aria-label={statusLabel[status]}
                      className={`h-5 w-6 rounded-sm transition-colors ${statusClass[status]}`}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
