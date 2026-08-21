import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays, formatDateISO } from '@/lib/utils'
import { TrainingBundle, TrainingSession } from '@/types'
import TrainingSessionCard from './TrainingSessionCard'

interface TrainingWeekCalendarProps {
  weekStart: Date
  onChangeWeek: (next: Date) => void
  byDate: Map<string, (TrainingSession & { id: string })[]>
  bundles: Map<string, TrainingBundle & { id: string }>
  colorByTrainer: Map<string, string>
  onSelectSession: (session: TrainingSession & { id: string }) => void
}

/**
 * Week grid — one column per day (Monday first), each holding only that
 * day's actual scheduled trainings; a day with nothing planned is simply
 * an empty column, not a placeholder message.
 */
export default function TrainingWeekCalendar({
  weekStart,
  onChangeWeek,
  byDate,
  bundles,
  colorByTrainer,
  onSelectSession
}: TrainingWeekCalendarProps) {
  const { t, i18n } = useTranslation()
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekEnd = days[6]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onChangeWeek(addDays(weekStart, -7))}
          className="p-1 text-text-secondary hover:text-primary"
          aria-label={t('trainingCalendar.previous')}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="text-white font-semibold text-sm sm:text-base">
          {weekStart.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })}
          {' – '}
          {weekEnd.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}
        </h2>
        <button
          type="button"
          onClick={() => onChangeWeek(addDays(weekStart, 7))}
          className="p-1 text-text-secondary hover:text-primary"
          aria-label={t('trainingCalendar.next')}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="overflow-x-auto custom-scrollbar">
        <div className="grid grid-cols-7 gap-2 min-w-[700px]">
          {days.map((day) => {
            const dISO = formatDateISO(day)
            const daySessions = byDate.get(dISO) ?? []
            return (
              <div key={dISO} className="space-y-2">
                <div className="text-center border-b border-border pb-2">
                  <p className="text-text-muted text-xs">{day.toLocaleDateString(i18n.language, { weekday: 'short' })}</p>
                  <p className="text-white font-medium">{day.getDate()}</p>
                </div>
                <div className="space-y-2">
                  {daySessions.map((s) => (
                    <TrainingSessionCard
                      key={s.id}
                      session={s}
                      bundle={s.bundleId ? (bundles.get(s.bundleId) ?? null) : null}
                      color={colorByTrainer.get(s.trainerId ?? '') ?? '#FDB913'}
                      onClick={() => onSelectSession(s)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
