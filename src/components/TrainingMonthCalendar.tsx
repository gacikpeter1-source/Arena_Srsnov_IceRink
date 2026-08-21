import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDateISO, getMonthEnd, getMonthStart } from '@/lib/utils'
import { TrainingBundle, TrainingSession } from '@/types'
import TrainingSessionCard from './TrainingSessionCard'

interface TrainingMonthCalendarProps {
  monthCursor: Date
  onChangeMonth: (next: Date) => void
  byDate: Map<string, (TrainingSession & { id: string })[]>
  bundles: Map<string, TrainingBundle & { id: string }>
  colorByTrainer: Map<string, string>
  selectedDate: string
  onSelectDate: (dateISO: string) => void
  onSelectSession: (session: TrainingSession & { id: string }) => void
}

// A Monday, purely to read locale weekday abbreviations off of — never
// rendered as an actual date.
const A_MONDAY = new Date(2024, 0, 1)

/**
 * Month grid for the public training calendar — a day's number is
 * highlighted when it has at least one scheduled training; clicking any
 * day (highlighted or not) shows that day's trainings below the grid.
 * Only ever shows actual trainings, never "free ice" slots — there's no
 * such concept in the training domain (see CLAUDE.md).
 */
export default function TrainingMonthCalendar({
  monthCursor,
  onChangeMonth,
  byDate,
  bundles,
  colorByTrainer,
  selectedDate,
  onSelectDate,
  onSelectSession
}: TrainingMonthCalendarProps) {
  const { t, i18n } = useTranslation()

  const monthStart = getMonthStart(monthCursor)
  const monthEnd = getMonthEnd(monthCursor)
  const daysInMonth = monthEnd.getDate()
  const leadingBlanks = (monthStart.getDay() + 6) % 7 // Monday-start week
  const cells: (string | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      formatDateISO(new Date(monthStart.getFullYear(), monthStart.getMonth(), i + 1))
    )
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const weekdayLabels = Array.from({ length: 7 }, (_, i) =>
    new Date(A_MONDAY.getFullYear(), A_MONDAY.getMonth(), A_MONDAY.getDate() + i).toLocaleDateString(i18n.language, {
      weekday: 'short'
    })
  )

  const selectedSessions = byDate.get(selectedDate) ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onChangeMonth(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}
          className="p-1 text-text-secondary hover:text-primary"
          aria-label={t('trainingCalendar.previous')}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="text-white font-semibold capitalize">
          {monthStart.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' })}
        </h2>
        <button
          type="button"
          onClick={() => onChangeMonth(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}
          className="p-1 text-text-secondary hover:text-primary"
          aria-label={t('trainingCalendar.next')}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {weekdayLabels.map((label, i) => (
          <div key={`${label}-${i}`} className="text-text-muted text-xs py-1">{label}</div>
        ))}
        {cells.map((dateISO, i) => {
          if (!dateISO) return <div key={`blank-${i}`} />
          const hasSessions = (byDate.get(dateISO)?.length ?? 0) > 0
          const isSelected = dateISO === selectedDate
          return (
            <button
              key={dateISO}
              type="button"
              onClick={() => onSelectDate(dateISO)}
              className={`aspect-square rounded-md text-sm flex items-center justify-center transition-colors ${
                isSelected
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : hasSessions
                    ? 'bg-primary/20 text-white hover:bg-primary/30'
                    : 'text-text-secondary hover:bg-background-dark'
              }`}
            >
              {Number(dateISO.slice(-2))}
            </button>
          )
        })}
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <h3 className="text-white font-semibold">
          {new Date(`${selectedDate}T00:00:00`).toLocaleDateString(i18n.language, {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
          })}
        </h3>
        {selectedSessions.length === 0 ? (
          <p className="text-text-muted text-sm">{t('trainingCalendar.noSessionsThisDay')}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {selectedSessions.map((s) => (
              <TrainingSessionCard
                key={s.id}
                session={s}
                bundle={s.bundleId ? (bundles.get(s.bundleId) ?? null) : null}
                color={colorByTrainer.get(s.trainerId ?? '') ?? '#FDB913'}
                onClick={() => onSelectSession(s)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
