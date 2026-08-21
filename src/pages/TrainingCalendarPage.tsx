import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { fetchTrainingSessionsInRange, fetchTrainingBundlesByIds } from '@/lib/training'
import { fetchTrainers } from '@/lib/staff'
import { addDays, formatDateISO, getMonthEnd, getMonthStart, getWeekStart } from '@/lib/utils'
import { StaffUser, TrainingBundle, TrainingSession } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import TrainingRegistrationModal from '@/components/TrainingRegistrationModal'
import TrainingSessionCard from '@/components/TrainingSessionCard'
import TrainingMonthCalendar from '@/components/TrainingMonthCalendar'
import TrainingWeekCalendar from '@/components/TrainingWeekCalendar'
import BackButton from '@/components/BackButton'

const LIST_DAYS_AHEAD = 14
const PALETTE = ['#FDB913', '#3b82f6', '#22c55e', '#ec4899', '#a855f7', '#f97316', '#06b6d4', '#ef4444']

type ViewMode = 'month' | 'week' | 'list'

export default function TrainingCalendarPage() {
  const { t, i18n } = useTranslation()
  const { club } = useClubData()
  const { staff } = useAuth()
  const isIceRinkStaff = staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'
  const [searchParams, setSearchParams] = useSearchParams()
  const [sessions, setSessions] = useState<(TrainingSession & { id: string })[]>([])
  const [bundles, setBundles] = useState<Map<string, TrainingBundle & { id: string }>>(new Map())
  const [trainers, setTrainers] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState<(TrainingSession & { id: string }) | null>(null)

  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [monthCursor, setMonthCursor] = useState(() => getMonthStart(new Date()))
  const [weekCursor, setWeekCursor] = useState(() => getWeekStart(new Date()))
  const [selectedMonthDate, setSelectedMonthDate] = useState(() => formatDateISO(new Date()))

  const trainerFilter = searchParams.get('trainer') ?? ''

  useEffect(() => {
    fetchTrainers().then(setTrainers)
  }, [])

  useEffect(() => {
    if (!club) return
    setLoading(true)
    let startDate: string
    let endDate: string
    if (viewMode === 'month') {
      startDate = formatDateISO(getMonthStart(monthCursor))
      endDate = formatDateISO(getMonthEnd(monthCursor))
    } else if (viewMode === 'week') {
      startDate = formatDateISO(weekCursor)
      endDate = formatDateISO(addDays(weekCursor, 6))
    } else {
      startDate = formatDateISO(new Date())
      endDate = formatDateISO(addDays(new Date(), LIST_DAYS_AHEAD - 1))
    }
    fetchTrainingSessionsInRange(club.id, startDate, endDate)
      .then(async (sessionResults) => {
        setSessions(sessionResults)
        const bundleIds = sessionResults.filter((s) => s.bundleId).map((s) => s.bundleId as string)
        setBundles(await fetchTrainingBundlesByIds(bundleIds))
      })
      .finally(() => setLoading(false))
  }, [club, viewMode, monthCursor, weekCursor])

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

  const listDates = Array.from({ length: LIST_DAYS_AHEAD }, (_, i) => formatDateISO(addDays(new Date(), i)))

  const closeModal = () => setSelectedSession(null)

  const viewButtonClass = (mode: ViewMode) =>
    `px-3 py-1.5 rounded-md text-sm transition-colors ${
      viewMode === mode ? 'bg-primary text-primary-foreground' : 'text-text-secondary hover:text-primary'
    }`

  return (
    <div className="content-container py-6 space-y-6">
      <BackButton fallback="/" />
      {(staff?.isTrainer || isIceRinkStaff) && (
        <Card className="arena-card border-primary">
          <CardContent className="pt-4 flex items-center justify-between flex-wrap gap-3">
            <p className="text-text-secondary text-sm">{t('trainingCalendar.manageNotice')}</p>
            <Link to="/admin/treningy">
              <Button size="sm" className="bg-primary hover:bg-primary-gold text-primary-foreground">
                {t('trainingCalendar.manageButton')}
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

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

      <div className="flex gap-1 bg-background-dark border border-border rounded-md p-1 w-fit">
        <button type="button" className={viewButtonClass('month')} onClick={() => setViewMode('month')}>
          {t('trainingCalendar.viewMonth')}
        </button>
        <button type="button" className={viewButtonClass('week')} onClick={() => setViewMode('week')}>
          {t('trainingCalendar.viewWeek')}
        </button>
        <button type="button" className={viewButtonClass('list')} onClick={() => setViewMode('list')}>
          {t('trainingCalendar.viewList')}
        </button>
      </div>

      {loading ? (
        <p className="text-text-muted">{t('common.loading')}</p>
      ) : viewMode === 'month' ? (
        <TrainingMonthCalendar
          monthCursor={monthCursor}
          onChangeMonth={(next) => {
            setMonthCursor(next)
            setSelectedMonthDate(formatDateISO(next))
          }}
          byDate={byDate}
          bundles={bundles}
          colorByTrainer={colorByTrainer}
          selectedDate={selectedMonthDate}
          onSelectDate={setSelectedMonthDate}
          onSelectSession={setSelectedSession}
        />
      ) : viewMode === 'week' ? (
        <TrainingWeekCalendar
          weekStart={weekCursor}
          onChangeWeek={setWeekCursor}
          byDate={byDate}
          bundles={bundles}
          colorByTrainer={colorByTrainer}
          onSelectSession={setSelectedSession}
        />
      ) : (
        <div className="space-y-4">
          {listDates.map((date) => {
            const daySessions = byDate.get(date) ?? []
            if (daySessions.length === 0) return null
            return (
              <Card key={date} className="arena-card">
                <CardContent className="pt-4">
                  <h2 className="text-white font-semibold mb-3">
                    {new Date(`${date}T00:00:00`).toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}
                  </h2>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {daySessions.map((s) => (
                      <TrainingSessionCard
                        key={s.id}
                        session={s}
                        bundle={s.bundleId ? (bundles.get(s.bundleId) ?? null) : null}
                        color={colorByTrainer.get(s.trainerId ?? '') ?? PALETTE[0]}
                        onClick={() => setSelectedSession(s)}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {listDates.every((d) => (byDate.get(d) ?? []).length === 0) && (
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
          asStaff={isIceRinkStaff}
        />
      )}
    </div>
  )
}
