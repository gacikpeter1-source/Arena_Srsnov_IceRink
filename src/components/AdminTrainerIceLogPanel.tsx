import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addTrainerIceLogEntry, fetchTrainerIceLog, deleteTrainerIceLogEntry } from '@/lib/training'
import { fetchTrainers } from '@/lib/staff'
import { formatDateISO } from '@/lib/utils'
import { StaffUser, TrainerIceLogEntry } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

interface AdminTrainerIceLogPanelProps {
  clubId: string
  loggedBy: string
  // Only owner/superadmin can read the log back — see firestore.rules
  // (deliberately not visible to the trainer it's about, and not to a
  // plain assistant who only logs entries).
  canViewLog: boolean
}

export default function AdminTrainerIceLogPanel({ clubId, loggedBy, canViewLog }: AdminTrainerIceLogPanelProps) {
  const { t } = useTranslation()
  const [trainers, setTrainers] = useState<StaffUser[]>([])
  const [entries, setEntries] = useState<(TrainerIceLogEntry & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [selectedTrainer, setSelectedTrainer] = useState('')
  const [date, setDate] = useState(formatDateISO(new Date()))
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const refresh = () => {
    setLoading(true)
    const loads: Promise<unknown>[] = [fetchTrainers().then(setTrainers)]
    if (canViewLog) loads.push(fetchTrainerIceLog(clubId).then(setEntries))
    Promise.all(loads).finally(() => setLoading(false))
  }

  useEffect(refresh, [clubId, canViewLog])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trainer = trainers.find((tr) => tr.uid === selectedTrainer)
    if (!trainer) return
    setSubmitting(true)
    try {
      await addTrainerIceLogEntry({
        clubId,
        trainerId: trainer.uid,
        trainerName: trainer.name,
        date,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        loggedBy
      })
      setNotes('')
      refresh()
    } catch (err) {
      console.error('Error logging trainer ice use:', err)
      alert(t('common.error'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('trainerIceLog.confirmDelete'))) return
    setBusyId(id)
    try {
      await deleteTrainerIceLogEntry(id)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card className="arena-card">
      <CardHeader>
        <CardTitle className="text-white">{t('trainerIceLog.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-text-secondary text-sm">{t('trainerIceLog.hint')}</p>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-4 items-end">
          <div className="sm:col-span-2">
            <Label className="text-white">{t('trainerIceLog.trainer')}</Label>
            <select
              value={selectedTrainer}
              onChange={(e) => setSelectedTrainer(e.target.value)}
              className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2"
              required
            >
              <option value="">{t('trainerIceLog.selectTrainer')}</option>
              {trainers.map((tr) => (
                <option key={tr.uid} value={tr.uid}>{tr.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-white">{t('common.date')}</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-background-dark border-border text-white" required />
          </div>
          <div>
            <Label className="text-white">{t('trainerIceLog.notes')}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-background-dark border-border text-white" />
          </div>
          <div className="sm:col-span-4">
            <Button type="submit" disabled={submitting || !selectedTrainer} className="bg-primary hover:bg-primary-gold text-primary-foreground">
              {submitting ? t('common.saving') : t('trainerIceLog.logEntry')}
            </Button>
          </div>
        </form>

        {canViewLog && (
          loading ? (
            <p className="text-text-muted">{t('common.loading')}</p>
          ) : entries.length === 0 ? (
            <p className="text-text-muted text-sm">{t('trainerIceLog.none')}</p>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => (
                <div key={entry.id} className="flex justify-between items-center p-2 rounded border border-border">
                  <div>
                    <p className="text-white">{entry.trainerName} — {entry.date}</p>
                    {entry.notes && <p className="text-text-secondary text-sm">{entry.notes}</p>}
                  </div>
                  <Button size="sm" variant="destructive" disabled={busyId === entry.id} onClick={() => handleDelete(entry.id)}>
                    {t('common.delete')}
                  </Button>
                </div>
              ))}
            </div>
          )
        )}
      </CardContent>
    </Card>
  )
}
