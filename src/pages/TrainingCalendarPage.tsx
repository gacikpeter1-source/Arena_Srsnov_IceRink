import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useClubData } from '@/hooks/useClubData'
import { fetchTrainingSessionsInRange, fetchTrainingBundlesByIds } from '@/lib/training'
import { fetchTrainers } from '@/lib/staff'
import { addDays, formatDateISO } from '@/lib/utils'
import { StaffUser, TrainingBundle, TrainingSession } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import TrainingRegistrationModal from '@/components/TrainingRegistrationModal'

const DAYS_AHEAD = 14
const PALETTE = ['#FDB913', '#3b82f6', '#22c55e', '#ec4899', '#a855f7', '#f97316', '#06b6d4', '#ef4444']

export default function TrainingCalendarPage() {
  const { t, i18n } = useTranslation()
  const { club } = useClubData()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sessions, setSessions] = useState<(TrainingSession & { id: string })[]>([])
  const [bundles, setBundles] = useState<Map<string, TrainingBundle & { id: string }>>(new Map())
  const [trainers, setTrainers] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState<(TrainingSession & { id: string }) | null>(null)

  const trainerFilter = searchParams.get('trainer') ?? ''

  useEffect(() => {
    if (!club) return
    setLoading(true)
    const startDate = formatDateISO(new Date())
    const endDate = formatDateISO(addDays(new Date(), DAYS_AHEAD))
    Promise.all([fetchTrainingSessionsInRange(club.id, startDate, endDate), fetchTrainers()])
      .then(async ([sessionResults, trainerResults]) => {
        setSessions(sessionResults)
        setTrainers(trainerResults)
        const bundleIds = sessionResults.filter((s) => s.bundleId).map((s) => s.bundleId as string)
        setBundles(await fetchTrainingBundlesByIds(bundleIds))
      })
      .finally(() => setLoading(false))
  }, [club])

  const colorByTrainer = useMemo(() => {
    const map = new Map<string, string>()
    trainers.forEach((tr, i) => map.set(tr.uid, tr.calendarColor || PALETTE[i % PALETTE.length]))
    return map
  }, [trainers])

  const filteredSessions = trainerFilter ? sessions.filter((s) => s.trainerId === trainerFilter) : sessions

  const byDate = useMemo(() => {
    const map = new Map<string, (TrainingSession & { id: string })[]>()
    filteredSessions.forEach((s) => {
      if (!map.has(s.date)) map.set(s.date, [])
      map.get(s.date)!.push(s)
    })
    return map
  }, [filteredSessions])

  const dates = Array.from({ length: DAYS_AHEAD }, (_, i) => formatDateISO(addDays(new Date(), i)))

  const closeModal = () => setSelectedSession(null)

  return (
    <div className="content-container py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-white">{t('trainingCalendar.title')}</h1>
        <select
          value={trainerFilter}
          onChange={(e) => setSearchParams(e.target.value ? { trainer: e.target.value } : {})}
          className="bg-background-dark border border-border text-white rounded-md px-3 py-2 text-sm"
        >
          <option value="">{t('trainingCalendar.allTrainers')}</option>
          {trainers.map((tr) => (
            <option key={tr.uid} value={tr.uid}>{tr.name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-text-muted">{t('common.loading')}</p>
      ) : (
        <div className="space-y-4">
          {dates.map((date) => {
            const daySessions = byDate.get(date) ?? []
            if (daySessions.length === 0) return null
            return (
              <Card key={date} className="arena-card">
                <CardContent className="pt-4">
                  <h2 className="text-white font-semibold mb-3">
                    {new Date(`${date}T00:00:00`).toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}
                  </h2>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {daySessions.map((s) => {
                      const bundle = s.bundleId ? bundles.get(s.bundleId) : null
                      const capacity = bundle ? bundle.capacity : s.capacity
                      const confirmedCount = bundle ? bundle.confirmedCount : s.confirmedCount
                      const isFull = capacity !== null && confirmedCount >= capacity
                      const color = colorByTrainer.get(s.trainerId ?? '') ?? PALETTE[0]
                      return (
                        <button
                          key={s.id}
                          onClick={() => setSelectedSession(s)}
                          className="text-left p-3 rounded-lg border border-border bg-background-dark hover:border-primary transition-colors"
                          style={{ borderLeftColor: color, borderLeftWidth: 4 }}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <p className="text-white font-medium">{bundle ? bundle.title : s.trainerName}</p>
                              <p className="text-text-secondary text-sm">{s.startTime} · {t('common.minutes', { count: s.durationMinutes })}</p>
                              {bundle && <p className="text-text-muted text-xs">{s.trainerName}</p>}
                            </div>
                            <span className={`text-xs font-medium ${isFull ? 'text-status-danger' : 'text-status-success'}`}>
                              {capacity === null ? t('trainingCalendar.unlimited') : `${confirmedCount}/${capacity}`}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {dates.every((d) => (byDate.get(d) ?? []).length === 0) && (
            <p className="text-text-muted">{t('trainingCalendar.noSessions')}</p>
          )}
        </div>
      )}

      {selectedSession && club && (
        <TrainingRegistrationModal
          isOpen={!!selectedSession}
          onClose={closeModal}
          club={club}
          session={selectedSession}
          bundle={selectedSession.bundleId ? bundles.get(selectedSession.bundleId) : null}
        />
      )}
    </div>
  )
}
