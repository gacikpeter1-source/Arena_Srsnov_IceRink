import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TrainingBundleRegistration, TrainingRegistration } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import BackButton from '@/components/BackButton'

const POLL_MS = 2500
const POLL_TIMEOUT_MS = 30000

/**
 * Where Stripe Checkout sends the customer back to after a training
 * payment (success_url/cancel_url — see createTicketCheckoutSession,
 * functions/src/payments.ts). A 'success' redirect doesn't mean the
 * payment is actually recorded yet — only stripeWebhook flipping
 * `payment.status` to 'paid' means that — so this page polls the
 * registration doc for a short while rather than trusting the redirect
 * itself; the real confirmation (with the QR code) always arrives by
 * email regardless of whether this page ever sees the 'paid' flip in
 * time.
 */
export default function TrainingPaymentStatusPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const status = params.get('status')
  const kind = params.get('kind')
  const regId = params.get('regId')

  const [paid, setPaid] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const startedAtRef = useRef(Date.now())

  useEffect(() => {
    if (status !== 'success' || !kind || !regId) return
    const collectionName = kind === 'bundle' ? 'trainingBundleRegistrations' : 'trainingRegistrations'

    let cancelled = false
    const poll = async () => {
      const snap = await getDoc(doc(db, collectionName, regId))
      const data = snap.data() as (TrainingRegistration | TrainingBundleRegistration) | undefined
      if (cancelled) return
      if (data?.payment?.status === 'paid') {
        setPaid(true)
        return
      }
      if (Date.now() - startedAtRef.current > POLL_TIMEOUT_MS) {
        setTimedOut(true)
        return
      }
      setTimeout(poll, POLL_MS)
    }
    poll()
    return () => {
      cancelled = true
    }
  }, [status, kind, regId])

  const titleKey = status === 'cancelled' ? 'trainingPayment.cancelledTitle' : paid ? 'trainingPayment.successTitle' : 'trainingPayment.waitingTitle'
  const noticeKey =
    status === 'cancelled' ? 'trainingPayment.cancelledNotice'
    : paid ? 'trainingPayment.successNotice'
    : timedOut ? 'trainingPayment.timedOutNotice'
    : 'trainingPayment.waitingNotice'

  return (
    <div className="content-container py-6 space-y-6 max-w-md mx-auto">
      <BackButton fallback="/treningy" />
      <Card className="arena-card">
        <CardContent className="py-8 flex flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-bold text-white">{t(titleKey)}</h1>
          <p className="text-text-secondary">{t(noticeKey)}</p>
          {status === 'success' && !paid && !timedOut && (
            <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          )}
          <Button asChild className="w-full bg-primary hover:bg-primary-gold text-primary-foreground mt-2">
            <a href="/treningy">{t('trainingPayment.backToCalendar')}</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
