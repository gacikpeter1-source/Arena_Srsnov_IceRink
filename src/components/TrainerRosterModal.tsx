import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  fetchSessionRegistrations,
  fetchBundleRegistrations,
  markSessionAttendance,
  markBundleSessionAttendance,
  fetchWalkInsForSession,
  addWalkIn,
  deleteWalkIn
} from '@/lib/training'
import { TrainingBundle, TrainingBundleRegistration, TrainingRegistration, TrainingSession, TrainingWalkIn } from '@/types'

interface TrainerRosterModalProps {
  isOpen: boolean
  onClose: () => void
  trainerId: string
  session: TrainingSession & { id: string }
  // Set when session.bundleId is set — registrations come from the bundle
  // (one signup covers every session), but attendance is still tracked
  // per real session via attendanceBySession[session.id].
  bundle?: (TrainingBundle & { id: string }) | null
}

/**
 * A trainer's own check-in screen for one session — marks which
 * registered participants actually showed up (see CLAUDE.md:
 * "attendance" here means CUSTOMER presence, not the trainer's own, which
 * is a different concept entirely — see trainerIceLog), plus logging
 * walk-ins (someone who showed up without registering at all).
 */
export default function TrainerRosterModal({ isOpen, onClose, trainerId, session, bundle }: TrainerRosterModalProps) {
  const { t } = useTranslation()
  const [sessionRegs, setSessionRegs] = useState<(TrainingRegistration & { id: string })[]>([])
  const [bundleRegs, setBundleRegs] = useState<(TrainingBundleRegistration & { id: string })[]>([])
  const [walkIns, setWalkIns] = useState<(TrainingWalkIn & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [walkInName, setWalkInName] = useState('')
  const [addingWalkIn, setAddingWalkIn] = useState(false)

  const refresh = () => {
    setLoading(true)
    const rosterPromise = bundle ? fetchBundleRegistrations(bundle.id) : fetchSessionRegistrations(session.id)
    Promise.all([rosterPromise, fetchWalkInsForSession(session.id)])
      .then(([roster, walkInResults]) => {
        if (bundle) setBundleRegs(roster as (TrainingBundleRegistration & { id: string })[])
        else setSessionRegs(roster as (TrainingRegistration & { id: string })[])
        setWalkIns(walkInResults)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (isOpen) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, session.id, bundle?.id])

  const toggleSessionAttendance = async (reg: TrainingRegistration & { id: string }) => {
    setBusyId(reg.id)
    try {
      await markSessionAttendance(reg.id, !reg.attendance?.checkedIn, trainerId)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  const toggleBundleAttendance = async (reg: TrainingBundleRegistration & { id: string }) => {
    setBusyId(reg.id)
    try {
      const checkedIn = reg.attendanceBySession?.[session.id]?.checkedIn ?? false
      await markBundleSessionAttendance(reg.id, session.id, !checkedIn, trainerId)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  const handleAddWalkIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!walkInName.trim()) return
    setAddingWalkIn(true)
    try {
      await addWalkIn({ clubId: session.clubId, sessionId: session.id, name: walkInName.trim(), addedBy: trainerId })
      setWalkInName('')
      refresh()
    } finally {
      setAddingWalkIn(false)
    }
  }

  const handleDeleteWalkIn = async (id: string) => {
    setBusyId(id)
    try {
      await deleteWalkIn(id)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  const registeredRoster = bundle ? bundleRegs : sessionRegs
  const relevantRoster = registeredRoster.filter((r) => r.status === 'confirmed' || r.status === 'waitlist')

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-background-card max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">
            {bundle ? bundle.title : t('trainerRoster.title')} — {session.date} {session.startTime}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-text-muted">{t('common.loading')}</p>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="text-white text-sm font-semibold mb-2">{t('trainerRoster.registered')}</h3>
              {relevantRoster.length === 0 ? (
                <p className="text-text-muted text-sm">{t('trainerRoster.noneRegistered')}</p>
              ) : (
                <div className="space-y-1">
                  {relevantRoster.map((reg) => {
                    const checkedIn = bundle
                      ? (reg as TrainingBundleRegistration).attendanceBySession?.[session.id]?.checkedIn ?? false
                      : (reg as TrainingRegistration).attendance?.checkedIn ?? false
                    return (
                      <div key={reg.id} className="flex items-center justify-between p-2 rounded border border-border">
                        <div>
                          <p className="text-white text-sm">{reg.name}{reg.status === 'waitlist' ? ` (${t('trainerRoster.waitlisted')})` : ''}</p>
                          <p className="text-text-secondary text-xs mono">{reg.confirmationCode}</p>
                        </div>
                        <Button
                          size="sm"
                          variant={checkedIn ? 'default' : 'outline'}
                          disabled={busyId === reg.id}
                          onClick={() => (bundle ? toggleBundleAttendance(reg as TrainingBundleRegistration & { id: string }) : toggleSessionAttendance(reg as TrainingRegistration & { id: string }))}
                        >
                          {checkedIn ? t('trainerRoster.checkedIn') : t('trainerRoster.markPresent')}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-white text-sm font-semibold mb-2">{t('trainerRoster.walkIns')}</h3>
              {walkIns.length > 0 && (
                <div className="space-y-1 mb-2">
                  {walkIns.map((w) => (
                    <div key={w.id} className="flex items-center justify-between p-2 rounded border border-border">
                      <p className="text-white text-sm">{w.name}</p>
                      <Button size="sm" variant="destructive" disabled={busyId === w.id} onClick={() => handleDeleteWalkIn(w.id)}>
                        {t('common.delete')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <form onSubmit={handleAddWalkIn} className="flex gap-2">
                <Input
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  placeholder={t('trainerRoster.walkInNamePlaceholder')}
                  className="bg-background-dark border-border text-white"
                />
                <Button type="submit" disabled={addingWalkIn || !walkInName.trim()}>{t('trainerRoster.addWalkIn')}</Button>
              </form>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
