import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import {
  createStandaloneSession,
  createTrainingSeries,
  createTrainingBundle,
  fetchTrainerSessions,
  fetchTrainerSeries,
  fetchTrainerBundles,
  deleteTrainingSession,
  deleteTrainingSeries,
  deleteTrainingBundle,
  TrainingSeriesRecurrence,
  TrainingBundleSessionInput
} from '@/lib/training'
import { useClubData } from '@/hooks/useClubData'
import { formatDateISO } from '@/lib/utils'
import { TrainingBundle, TrainingFrequency, TrainingSeries, TrainingSession } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const DEFAULT_CUTOFF_HOURS = 2

type Tab = 'sessions' | 'series' | 'bundles'

export default function TrainerDashboardPage() {
  const { t } = useTranslation()
  const { user, staff } = useAuth()
  const { club } = useClubData()
  const [tab, setTab] = useState<Tab>('sessions')

  const [sessions, setSessions] = useState<(TrainingSession & { id: string })[]>([])
  const [series, setSeries] = useState<(TrainingSeries & { id: string })[]>([])
  const [bundles, setBundles] = useState<(TrainingBundle & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Standalone session form
  const [sDate, setSDate] = useState(formatDateISO(new Date()))
  const [sTime, setSTime] = useState('17:00')
  const [sDuration, setSDuration] = useState(60)
  const [sCapacity, setSCapacity] = useState<string>('10')
  const [creatingSession, setCreatingSession] = useState(false)

  // Series form
  const [seTitle, setSeTitle] = useState('')
  const [seStartDate, setSeStartDate] = useState(formatDateISO(new Date()))
  const [seTime, setSeTime] = useState('17:00')
  const [seDuration, setSeDuration] = useState(60)
  const [seCapacity, setSeCapacity] = useState<string>('10')
  const [seFrequency, setSeFrequency] = useState<TrainingFrequency>('weekly')
  const [seCount, setSeCount] = useState(8)
  const [creatingSeries, setCreatingSeries] = useState(false)

  // Bundle form
  const [buTitle, setBuTitle] = useState('')
  const [buCapacity, setBuCapacity] = useState<string>('10')
  const [buSessions, setBuSessions] = useState<TrainingBundleSessionInput[]>([
    { date: formatDateISO(new Date()), startTime: '17:00', durationMinutes: 60 }
  ])
  const [creatingBundle, setCreatingBundle] = useState(false)

  const trainerId = user?.uid ?? ''
  const trainerName = staff?.name ?? ''

  const refresh = () => {
    if (!trainerId) return
    setLoading(true)
    Promise.all([fetchTrainerSessions(trainerId), fetchTrainerSeries(trainerId), fetchTrainerBundles(trainerId)])
      .then(([se, sr, bu]) => {
        setSessions(se)
        setSeries(sr)
        setBundles(bu)
      })
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [trainerId])

  if (staff && !staff.isTrainer) {
    return (
      <div className="content-container py-12 max-w-md mx-auto text-center space-y-4">
        <h1>{t('trainerDashboard.notATrainerTitle')}</h1>
        <p className="text-text-secondary">{t('trainerDashboard.notATrainerNotice')}</p>
        <Link to="/admin"><Button variant="outline">{t('trainerDashboard.backToIceRink')}</Button></Link>
      </div>
    )
  }

  const parseCapacity = (v: string): number | null => (v.trim() === '' ? null : Math.max(0, parseInt(v, 10) || 0))

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!club || !trainerId) return
    setCreatingSession(true)
    try {
      await createStandaloneSession({
        clubId: club.id,
        trainerId,
        trainerName,
        date: sDate,
        startTime: sTime,
        durationMinutes: sDuration,
        capacity: parseCapacity(sCapacity),
        cancellationCutoffHours: DEFAULT_CUTOFF_HOURS
      })
      refresh()
    } catch (err) {
      console.error('Error creating training session:', err)
      alert(t('common.error'))
    } finally {
      setCreatingSession(false)
    }
  }

  const handleCreateSeries = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!club || !trainerId || !seTitle.trim()) return
    setCreatingSeries(true)
    try {
      const recurrence: TrainingSeriesRecurrence = { type: 'count', frequency: seFrequency, count: seCount }
      await createTrainingSeries({
        clubId: club.id,
        trainerId,
        trainerName,
        title: seTitle,
        startDate: seStartDate,
        startTime: seTime,
        durationMinutes: seDuration,
        capacity: parseCapacity(seCapacity),
        cancellationCutoffHours: DEFAULT_CUTOFF_HOURS,
        recurrence
      })
      setSeTitle('')
      refresh()
    } catch (err) {
      console.error('Error creating training series:', err)
      alert(t('common.error'))
    } finally {
      setCreatingSeries(false)
    }
  }

  const handleCreateBundle = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!club || !trainerId || !buTitle.trim()) return
    setCreatingBundle(true)
    try {
      await createTrainingBundle({
        clubId: club.id,
        trainerId,
        trainerName,
        title: buTitle,
        capacity: parseCapacity(buCapacity),
        cancellationCutoffHours: DEFAULT_CUTOFF_HOURS,
        sessions: buSessions
      })
      setBuTitle('')
      setBuSessions([{ date: formatDateISO(new Date()), startTime: '17:00', durationMinutes: 60 }])
      refresh()
    } catch (err) {
      console.error('Error creating training bundle:', err)
      alert(t('common.error'))
    } finally {
      setCreatingBundle(false)
    }
  }

  const handleDeleteSession = async (id: string, confirmedCount: number) => {
    if (confirmedCount > 0 && !confirm(t('trainerDashboard.confirmDeleteWithRegistrations'))) return
    if (confirmedCount === 0 && !confirm(t('trainerDashboard.confirmDelete'))) return
    setBusyId(id)
    try {
      await deleteTrainingSession(id)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  const handleDeleteSeries = async (id: string) => {
    if (!confirm(t('trainerDashboard.confirmDeleteWithRegistrations'))) return
    setBusyId(id)
    try {
      await deleteTrainingSeries(id)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  const handleDeleteBundle = async (id: string) => {
    if (!confirm(t('trainerDashboard.confirmDeleteWithRegistrations'))) return
    setBusyId(id)
    try {
      await deleteTrainingBundle(id)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  const standaloneSessions = sessions.filter((s) => !s.seriesId && !s.bundleId)

  return (
    <div className="content-container py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-white">{t('trainerDashboard.title')}</h1>
        {staff && staff.role !== 'pending' && (
          <Link to="/admin">
            <Button variant="outline" size="sm">{t('trainerDashboard.backToIceRink')}</Button>
          </Link>
        )}
      </div>

      <div className="flex gap-2">
        {(['sessions', 'series', 'bundles'] as Tab[]).map((tb) => (
          <Button key={tb} variant={tab === tb ? 'default' : 'outline'} size="sm" onClick={() => setTab(tb)}>
            {t(`trainerDashboard.tab.${tb}`)}
          </Button>
        ))}
      </div>

      {tab === 'sessions' && (
        <>
          <Card className="arena-card">
            <CardHeader><CardTitle className="text-white">{t('trainerDashboard.newSession')}</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleCreateSession} className="grid gap-3 sm:grid-cols-4">
                <div>
                  <Label className="text-white">{t('common.date')}</Label>
                  <Input type="date" value={sDate} onChange={(e) => setSDate(e.target.value)} className="bg-background-dark border-border text-white" required />
                </div>
                <div>
                  <Label className="text-white">{t('common.time')}</Label>
                  <Input type="time" value={sTime} onChange={(e) => setSTime(e.target.value)} className="bg-background-dark border-border text-white" required />
                </div>
                <div>
                  <Label className="text-white">{t('trainerDashboard.durationMin')}</Label>
                  <Input type="number" min={1} value={sDuration} onChange={(e) => setSDuration(parseInt(e.target.value, 10) || 60)} className="bg-background-dark border-border text-white" required />
                </div>
                <div>
                  <Label className="text-white">{t('trainerDashboard.capacity')}</Label>
                  <Input value={sCapacity} onChange={(e) => setSCapacity(e.target.value)} placeholder={t('trainerDashboard.unlimitedPlaceholder')} className="bg-background-dark border-border text-white" />
                </div>
                <div className="sm:col-span-4">
                  <Button type="submit" disabled={creatingSession} className="bg-primary hover:bg-primary-gold text-primary-foreground">
                    {creatingSession ? t('common.saving') : t('trainerDashboard.createSession')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <SessionsList
            sessions={standaloneSessions}
            loading={loading}
            busyId={busyId}
            onDelete={handleDeleteSession}
            t={t}
          />
        </>
      )}

      {tab === 'series' && (
        <>
          <Card className="arena-card">
            <CardHeader><CardTitle className="text-white">{t('trainerDashboard.newSeries')}</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleCreateSeries} className="grid gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <Label className="text-white">{t('trainerDashboard.seriesTitle')}</Label>
                  <Input value={seTitle} onChange={(e) => setSeTitle(e.target.value)} className="bg-background-dark border-border text-white" required />
                </div>
                <div>
                  <Label className="text-white">{t('trainerDashboard.frequency')}</Label>
                  <select value={seFrequency} onChange={(e) => setSeFrequency(e.target.value as TrainingFrequency)} className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2">
                    <option value="weekly">{t('trainerDashboard.weekly')}</option>
                    <option value="daily">{t('trainerDashboard.daily')}</option>
                  </select>
                </div>
                <div>
                  <Label className="text-white">{t('trainerDashboard.occurrences')}</Label>
                  <Input type="number" min={1} value={seCount} onChange={(e) => setSeCount(parseInt(e.target.value, 10) || 1)} className="bg-background-dark border-border text-white" required />
                </div>
                <div>
                  <Label className="text-white">{t('trainerDashboard.startDate')}</Label>
                  <Input type="date" value={seStartDate} onChange={(e) => setSeStartDate(e.target.value)} className="bg-background-dark border-border text-white" required />
                </div>
                <div>
                  <Label className="text-white">{t('common.time')}</Label>
                  <Input type="time" value={seTime} onChange={(e) => setSeTime(e.target.value)} className="bg-background-dark border-border text-white" required />
                </div>
                <div>
                  <Label className="text-white">{t('trainerDashboard.durationMin')}</Label>
                  <Input type="number" min={1} value={seDuration} onChange={(e) => setSeDuration(parseInt(e.target.value, 10) || 60)} className="bg-background-dark border-border text-white" required />
                </div>
                <div>
                  <Label className="text-white">{t('trainerDashboard.capacity')}</Label>
                  <Input value={seCapacity} onChange={(e) => setSeCapacity(e.target.value)} placeholder={t('trainerDashboard.unlimitedPlaceholder')} className="bg-background-dark border-border text-white" />
                </div>
                <div className="sm:col-span-4">
                  <Button type="submit" disabled={creatingSeries} className="bg-primary hover:bg-primary-gold text-primary-foreground">
                    {creatingSeries ? t('common.saving') : t('trainerDashboard.createSeries')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="arena-card">
            <CardHeader><CardTitle className="text-white">{t('trainerDashboard.mySeries')}</CardTitle></CardHeader>
            <CardContent>
              {loading ? <p className="text-text-muted">{t('common.loading')}</p> : series.length === 0 ? (
                <p className="text-text-muted text-sm">{t('trainerDashboard.noneYet')}</p>
              ) : (
                <div className="space-y-2">
                  {series.map((sr) => (
                    <div key={sr.id} className="flex justify-between items-center p-2 rounded border border-border">
                      <div>
                        <p className="text-white">{sr.title}</p>
                        <p className="text-text-secondary text-sm">{t(`trainerDashboard.${sr.frequency}`)} · {sr.startTime}</p>
                      </div>
                      <Button size="sm" variant="destructive" disabled={busyId === sr.id} onClick={() => handleDeleteSeries(sr.id)}>
                        {t('common.delete')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {tab === 'bundles' && (
        <>
          <Card className="arena-card">
            <CardHeader><CardTitle className="text-white">{t('trainerDashboard.newBundle')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleCreateBundle} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-white">{t('trainerDashboard.bundleTitle')}</Label>
                    <Input value={buTitle} onChange={(e) => setBuTitle(e.target.value)} className="bg-background-dark border-border text-white" required />
                  </div>
                  <div>
                    <Label className="text-white">{t('trainerDashboard.capacity')}</Label>
                    <Input value={buCapacity} onChange={(e) => setBuCapacity(e.target.value)} placeholder={t('trainerDashboard.unlimitedPlaceholder')} className="bg-background-dark border-border text-white" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-white">{t('trainerDashboard.bundleSessions')}</Label>
                  {buSessions.map((s, i) => (
                    <div key={i} className="grid grid-cols-4 gap-2 items-end">
                      <Input type="date" value={s.date} onChange={(e) => setBuSessions(buSessions.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} className="bg-background-dark border-border text-white" required />
                      <Input type="time" value={s.startTime} onChange={(e) => setBuSessions(buSessions.map((x, j) => j === i ? { ...x, startTime: e.target.value } : x))} className="bg-background-dark border-border text-white" required />
                      <Input type="number" min={1} value={s.durationMinutes} onChange={(e) => setBuSessions(buSessions.map((x, j) => j === i ? { ...x, durationMinutes: parseInt(e.target.value, 10) || 60 } : x))} className="bg-background-dark border-border text-white" required />
                      <Button type="button" variant="destructive" size="sm" onClick={() => setBuSessions(buSessions.filter((_, j) => j !== i))} disabled={buSessions.length === 1}>
                        {t('common.delete')}
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={() => setBuSessions([...buSessions, { date: formatDateISO(new Date()), startTime: '17:00', durationMinutes: 60 }])}>
                    {t('trainerDashboard.addSession')}
                  </Button>
                </div>

                <Button type="submit" disabled={creatingBundle} className="bg-primary hover:bg-primary-gold text-primary-foreground">
                  {creatingBundle ? t('common.saving') : t('trainerDashboard.createBundle')}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="arena-card">
            <CardHeader><CardTitle className="text-white">{t('trainerDashboard.myBundles')}</CardTitle></CardHeader>
            <CardContent>
              {loading ? <p className="text-text-muted">{t('common.loading')}</p> : bundles.length === 0 ? (
                <p className="text-text-muted text-sm">{t('trainerDashboard.noneYet')}</p>
              ) : (
                <div className="space-y-2">
                  {bundles.map((bu) => (
                    <div key={bu.id} className="flex justify-between items-center p-2 rounded border border-border">
                      <div>
                        <p className="text-white">{bu.title}</p>
                        <p className="text-text-secondary text-sm">{bu.confirmedCount}/{bu.capacity ?? '∞'}</p>
                      </div>
                      <Button size="sm" variant="destructive" disabled={busyId === bu.id} onClick={() => handleDeleteBundle(bu.id)}>
                        {t('common.delete')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function SessionsList({
  sessions,
  loading,
  busyId,
  onDelete,
  t
}: {
  sessions: (TrainingSession & { id: string })[]
  loading: boolean
  busyId: string | null
  onDelete: (id: string, confirmedCount: number) => void
  t: (key: string) => string
}) {
  return (
    <Card className="arena-card">
      <CardHeader><CardTitle className="text-white">{t('trainerDashboard.mySessions')}</CardTitle></CardHeader>
      <CardContent>
        {loading ? <p className="text-text-muted">{t('common.loading')}</p> : sessions.length === 0 ? (
          <p className="text-text-muted text-sm">{t('trainerDashboard.noneYet')}</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div key={s.id} className="flex justify-between items-center p-2 rounded border border-border">
                <div>
                  <p className="text-white">{s.date} · {s.startTime}</p>
                  <p className="text-text-secondary text-sm">{s.confirmedCount}/{s.capacity ?? '∞'}</p>
                </div>
                <Button size="sm" variant="destructive" disabled={busyId === s.id} onClick={() => onDelete(s.id, s.confirmedCount)}>
                  {t('common.delete')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
