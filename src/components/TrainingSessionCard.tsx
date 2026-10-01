import { useTranslation } from 'react-i18next'
import { TrainingBundle, TrainingSeries, TrainingSession } from '@/types'

interface TrainingSessionCardProps {
  session: TrainingSession & { id: string }
  bundle: (TrainingBundle & { id: string }) | null
  // Set when the session belongs to a recurring series (see
  // fetchTrainingSeriesByIds) — gives a series-linked session a real name
  // to show, the same way `bundle` already does for a bundle-linked one.
  series?: (TrainingSeries & { id: string }) | null
  color: string
  onClick: () => void
}

/**
 * One clickable training card — shared by the calendar's list, week, and
 * month-daily-overview views. The event's own name (bundle/series title)
 * is the prominent line; the trainer and the date/time are both secondary
 * detail shown smaller underneath — a customer scanning the calendar
 * cares first about *what* it is, not who's running it or exactly when.
 * A standalone session with neither a bundle nor a series has no name of
 * its own at all, so it falls back to the trainer's name as the headline,
 * same as before this card could show a title.
 */
export default function TrainingSessionCard({ session, bundle, series, color, onClick }: TrainingSessionCardProps) {
  const { t } = useTranslation()
  const capacity = bundle ? bundle.capacity : session.capacity
  const confirmedCount = bundle ? bundle.confirmedCount : session.confirmedCount
  const isFull = capacity !== null && confirmedCount >= capacity
  const title = bundle ? bundle.title : series ? series.title : null

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 rounded-lg border border-border bg-background-dark hover:border-primary transition-colors"
      style={{ borderLeftColor: color, borderLeftWidth: 4 }}
    >
      <div className="flex justify-between items-start gap-2">
        <div>
          <p className="text-white font-medium text-base">{title ?? session.trainerName}</p>
          {title && <p className="text-text-muted text-xs">{session.trainerName}</p>}
          <p className="text-text-secondary text-xs">{session.startTime} · {t('common.minutes', { count: session.durationMinutes })}</p>
        </div>
        <span className={`text-xs font-medium ${isFull ? 'text-status-danger' : 'text-status-success'}`}>
          {capacity === null ? t('trainingCalendar.unlimited') : `${confirmedCount}/${capacity}`}
        </span>
      </div>
    </button>
  )
}
