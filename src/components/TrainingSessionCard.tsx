import { useTranslation } from 'react-i18next'
import { TrainingBundle, TrainingSession } from '@/types'

interface TrainingSessionCardProps {
  session: TrainingSession & { id: string }
  bundle: (TrainingBundle & { id: string }) | null
  color: string
  onClick: () => void
}

/** One clickable training card — shared by the calendar's list, week, and month-daily-overview views. */
export default function TrainingSessionCard({ session, bundle, color, onClick }: TrainingSessionCardProps) {
  const { t } = useTranslation()
  const capacity = bundle ? bundle.capacity : session.capacity
  const confirmedCount = bundle ? bundle.confirmedCount : session.confirmedCount
  const isFull = capacity !== null && confirmedCount >= capacity

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 rounded-lg border border-border bg-background-dark hover:border-primary transition-colors"
      style={{ borderLeftColor: color, borderLeftWidth: 4 }}
    >
      <div className="flex justify-between items-start gap-2">
        <div>
          <p className="text-white font-medium">{bundle ? bundle.title : session.trainerName}</p>
          <p className="text-text-secondary text-sm">{session.startTime} · {t('common.minutes', { count: session.durationMinutes })}</p>
          {bundle && <p className="text-text-muted text-xs">{session.trainerName}</p>}
        </div>
        <span className={`text-xs font-medium ${isFull ? 'text-status-danger' : 'text-status-success'}`}>
          {capacity === null ? t('trainingCalendar.unlimited') : `${confirmedCount}/${capacity}`}
        </span>
      </div>
    </button>
  )
}
