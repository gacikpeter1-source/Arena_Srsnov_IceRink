import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useClubData } from '@/hooks/useClubData'
import { confirmSessionRegistration, confirmBundleRegistration, TrainingConfirmationError } from '@/lib/training'
import { queueTrainingConfirmationEmail, queueBundleConfirmationEmail } from '@/lib/email'
import { isSupportedLanguage } from '@/i18n'
import { doc, getDocs, collection, query, where, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TrainingBundle, TrainingSession } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type State = 'confirming' | 'confirmed' | 'expired' | 'invalid' | 'error'

interface TrainingConfirmPageProps {
  kind: 'session' | 'bundle'
}

/**
 * Confirms a pending training registration via its emailed link — mirrors
 * ConfirmBookingPage, one component handling both the per-session
 * (trainingRegistrations) and per-bundle (trainingBundleRegistrations)
 * flows since they're otherwise identical, distinguished by `kind`
 * (two routes in App.tsx point at the same component).
 */
export default function TrainingConfirmPage({ kind }: TrainingConfirmPageProps) {
  const { t, i18n } = useTranslation()
  const { regId, token } = useParams<{ regId: string; token: string }>()
  const { club } = useClubData()
  const [state, setState] = useState<State>('confirming')
  const [details, setDetails] = useState<{ date: string; startTime: string; confirmationCode: string; title: string } | null>(null)
  const ranRef = useRef(false)

  useEffect(() => {
    async function run() {
      if (!regId || !token || !club) return
      if (ranRef.current) return
      ranRef.current = true

      try {
        if (kind === 'session') {
          const { registration: confirmed, alreadyConfirmed } = await confirmSessionRegistration(regId, token)
          const sessionSnap = await getDoc(doc(db, 'trainingSessions', confirmed.sessionId))
          const trainerName = sessionSnap.exists() ? (sessionSnap.data() as TrainingSession).trainerName ?? '' : ''
          setDetails({
            date: confirmed.date,
            startTime: confirmed.startTime,
            confirmationCode: confirmed.confirmationCode,
            title: trainerName
          })
          setState('confirmed')
          if (!alreadyConfirmed) {
            queueTrainingConfirmationEmail(
              club,
              {
                registrationId: regId,
                cancellationToken: confirmed.cancellationToken,
                confirmationCode: confirmed.confirmationCode,
                date: confirmed.date,
                startTime: confirmed.startTime,
                durationMinutes: confirmed.durationMinutes,
                trainerName,
                name: confirmed.name,
                email: confirmed.email
              },
              window.location.origin,
              isSupportedLanguage(i18n.language) ? i18n.language : 'en'
            )
          }
        } else {
          const { registration: confirmed, alreadyConfirmed } = await confirmBundleRegistration(regId, token)
          const bundleSnap = await getDoc(doc(db, 'trainingBundles', confirmed.bundleId))
          const bundle = bundleSnap.exists() ? ({ id: bundleSnap.id, ...bundleSnap.data() } as TrainingBundle & { id: string }) : null
          setDetails({ date: '', startTime: '', confirmationCode: confirmed.confirmationCode, title: bundle?.title ?? '' })
          setState('confirmed')
          if (!alreadyConfirmed && bundle) {
            const sessionsSnap = await getDocs(
              query(collection(db, 'trainingSessions'), where('bundleId', '==', confirmed.bundleId))
            )
            const sessions = sessionsSnap.docs
              .map((d) => d.data() as TrainingSession)
              .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)))
            queueBundleConfirmationEmail(
              club,
              {
                registrationId: regId,
                cancellationToken: confirmed.cancellationToken,
                confirmationCode: confirmed.confirmationCode,
                title: bundle.title,
                trainerName: bundle.trainerName,
                name: confirmed.name,
                email: confirmed.email,
                sessions: sessions.map((s) => ({ date: s.date, startTime: s.startTime, durationMinutes: s.durationMinutes }))
              },
              window.location.origin,
              isSupportedLanguage(i18n.language) ? i18n.language : 'en'
            )
          }
        }
      } catch (err) {
        if (err instanceof TrainingConfirmationError) {
          setState(err.message === 'This registration has expired' ? 'expired' : 'invalid')
        } else {
          console.error('Error confirming training registration:', err)
          setState('error')
        }
      }
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regId, token, club, kind])

  return (
    <div className="content-container py-6 max-w-md mx-auto">
      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white">{t('trainingConfirm.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {state === 'confirming' && <p className="text-text-muted">{t('common.loading')}</p>}
          {state === 'invalid' && <p className="text-status-danger">{t('trainingConfirm.invalidLink')}</p>}
          {state === 'error' && <p className="text-status-danger">{t('common.error')}</p>}
          {state === 'expired' && (
            <div className="space-y-2">
              <p className="text-status-danger">{t('trainingConfirm.expired')}</p>
              <p className="text-text-muted text-sm">{t('trainingConfirm.expiredHint')}</p>
            </div>
          )}
          {state === 'confirmed' && details && (
            <div className="space-y-4 text-center">
              <p className="text-status-success">{t('trainingConfirm.success')}</p>
              <div className="text-text-secondary space-y-1">
                {kind === 'session' && <p>{t('common.dateAtTime', { date: details.date, startTime: details.startTime })}</p>}
                {kind === 'bundle' && details.title && <p><strong className="text-white">{details.title}</strong></p>}
                <p className="mono text-primary">{details.confirmationCode}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
