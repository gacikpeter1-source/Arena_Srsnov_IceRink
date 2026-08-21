import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useClubData } from '@/hooks/useClubData'
import { cancelSessionRegistration, cancelBundleRegistration, isPastTrainingCancellationCutoff } from '@/lib/training'
import {
  queueTrainingCancellationEmail,
  queueBundleCancellationEmail,
  queueTrainingConfirmationEmail,
  queueBundleConfirmationEmail
} from '@/lib/email'
import { isSupportedLanguage } from '@/i18n'
import { TrainingBundle, TrainingBundleRegistration, TrainingRegistration, TrainingSession } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import BackButton from '@/components/BackButton'

type State = 'loading' | 'invalid' | 'expired' | 'ready' | 'locked' | 'pending' | 'waitlist' | 'already_cancelled' | 'cancelled' | 'error'

interface TrainingCancelPageProps {
  kind: 'session' | 'bundle'
}

/**
 * Self-service cancel via the emailed link — mirrors CancelViaTokenPage,
 * shared between session and bundle registrations (see
 * TrainingConfirmPage for why one component handles both).
 */
export default function TrainingCancelPage({ kind }: TrainingCancelPageProps) {
  const { t, i18n } = useTranslation()
  const { regId, token } = useParams<{ regId: string; token: string }>()
  const { club } = useClubData()
  const [state, setState] = useState<State>('loading')
  const [reg, setReg] = useState<(TrainingRegistration | TrainingBundleRegistration) & { id: string } | null>(null)
  const [label, setLabel] = useState<{ trainerName: string; title: string }>({ trainerName: '', title: '' })

  useEffect(() => {
    async function load() {
      if (!regId || !token) {
        setState('invalid')
        return
      }
      const collectionName = kind === 'session' ? 'trainingRegistrations' : 'trainingBundleRegistrations'
      const snap = await getDoc(doc(db, collectionName, regId))
      if (!snap.exists()) {
        setState('invalid')
        return
      }
      const found = { id: snap.id, ...snap.data() } as (TrainingRegistration | TrainingBundleRegistration) & { id: string }
      if (found.cancellationToken !== token) {
        setState('invalid')
        return
      }
      if (new Date(found.tokenExpiresAt as unknown as string) < new Date()) {
        setState('expired')
        return
      }
      setReg(found)

      let locked = false
      if (kind === 'session') {
        const sessionReg = found as TrainingRegistration
        const sessionSnap = await getDoc(doc(db, 'trainingSessions', sessionReg.sessionId))
        if (sessionSnap.exists()) {
          const session = sessionSnap.data() as TrainingSession
          setLabel({ trainerName: session.trainerName ?? '', title: '' })
          if (found.status === 'confirmed' && club) {
            locked = isPastTrainingCancellationCutoff(sessionReg.date, sessionReg.startTime, club.timezone, session.cancellationCutoffHours)
          }
        }
      } else {
        const bundleSnap = await getDoc(doc(db, 'trainingBundles', (found as TrainingBundleRegistration).bundleId))
        if (bundleSnap.exists()) {
          const bundle = bundleSnap.data() as TrainingBundle
          setLabel({ trainerName: bundle.trainerName, title: bundle.title })
        }
      }

      if (found.status === 'cancelled') setState('already_cancelled')
      else if (locked) setState('locked')
      else if (found.status === 'pending') setState('pending')
      else if (found.status === 'waitlist') setState('waitlist')
      else setState('ready')
    }
    load()
  }, [regId, token, kind, club])

  // cancelSessionRegistration/cancelBundleRegistration auto-promote the
  // next waitlisted registration when this cancel frees a real spot (see
  // lib/training.ts) — the promoted registration comes back from that call
  // so this page can queue their "you got a spot" confirmation email too,
  // in their own signup-time language rather than this canceller's.
  const handleCancel = async () => {
    if (!reg || !club) return
    try {
      if (kind === 'session') {
        const sessionReg = reg as TrainingRegistration
        const promoted = await cancelSessionRegistration(reg.id)
        await queueTrainingCancellationEmail(
          club,
          {
            name: sessionReg.name,
            email: sessionReg.email,
            date: sessionReg.date,
            startTime: sessionReg.startTime,
            trainerName: label.trainerName,
            confirmationCode: sessionReg.confirmationCode
          },
          isSupportedLanguage(i18n.language) ? i18n.language : 'en'
        )
        if (promoted) {
          await queueTrainingConfirmationEmail(
            club,
            {
              registrationId: promoted.id,
              cancellationToken: promoted.cancellationToken,
              confirmationCode: promoted.confirmationCode,
              date: promoted.date,
              startTime: promoted.startTime,
              durationMinutes: promoted.durationMinutes,
              trainerName: label.trainerName,
              name: promoted.name,
              email: promoted.email
            },
            window.location.origin,
            promoted.language ?? 'sk'
          ).catch(() => {})
        }
      } else {
        const bundleReg = reg as TrainingBundleRegistration
        const promoted = await cancelBundleRegistration(reg.id)
        await queueBundleCancellationEmail(
          club,
          {
            name: bundleReg.name,
            email: bundleReg.email,
            title: label.title,
            trainerName: label.trainerName,
            confirmationCode: bundleReg.confirmationCode
          },
          isSupportedLanguage(i18n.language) ? i18n.language : 'en'
        )
        if (promoted) {
          const sessionsSnap = await getDocs(query(collection(db, 'trainingSessions'), where('bundleId', '==', bundleReg.bundleId)))
          const bundleSessions = sessionsSnap.docs
            .map((d) => d.data() as TrainingSession)
            .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)))
          await queueBundleConfirmationEmail(
            club,
            {
              registrationId: promoted.id,
              cancellationToken: promoted.cancellationToken,
              confirmationCode: promoted.confirmationCode,
              title: label.title,
              trainerName: label.trainerName,
              name: promoted.name,
              email: promoted.email,
              sessions: bundleSessions.map((s) => ({ date: s.date, startTime: s.startTime, durationMinutes: s.durationMinutes }))
            },
            window.location.origin,
            promoted.language ?? 'sk'
          ).catch(() => {})
        }
      }
      setState('cancelled')
    } catch (err) {
      console.error('Error cancelling training registration:', err)
      setState('error')
    }
  }

  return (
    <div className="content-container py-6 max-w-md mx-auto">
      <BackButton fallback="/" />
      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white">{t('trainingCancel.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {state === 'loading' && <p className="text-text-muted">{t('common.loading')}</p>}
          {state === 'invalid' && <p className="text-status-danger">{t('trainingCancel.invalidLink')}</p>}
          {state === 'expired' && <p className="text-status-danger">{t('trainingCancel.expiredLink')}</p>}
          {state === 'error' && <p className="text-status-danger">{t('common.error')}</p>}
          {state === 'already_cancelled' && <p className="text-status-muted">{t('trainingCancel.alreadyCancelled')}</p>}
          {state === 'cancelled' && <p className="text-status-success">{t('trainingCancel.cancelled')}</p>}
          {state === 'pending' && <p className="text-status-muted">{t('trainingCancel.awaitingConfirmation')}</p>}
          {state === 'waitlist' && <p className="text-status-muted">{t('trainingCancel.onWaitlist')}</p>}

          {(state === 'ready' || state === 'locked' || state === 'waitlist' || state === 'pending') && reg && club && (
            <div className="space-y-4">
              <div className="text-text-secondary space-y-1">
                {label.title && <p><strong className="text-white">{label.title}</strong></p>}
                <p>{label.trainerName}</p>
                {kind === 'session' && (
                  <p>{t('common.dateAtTime', { date: (reg as TrainingRegistration).date, startTime: (reg as TrainingRegistration).startTime })}</p>
                )}
                <p className="mono text-primary">{reg.confirmationCode}</p>
              </div>
              {state === 'locked' ? (
                <p className="text-status-muted text-sm">{t('trainingCancel.cancellationLocked')}</p>
              ) : (
                <Button onClick={handleCancel} variant="destructive" className="w-full">
                  {t('trainingCancel.cancelThis')}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
