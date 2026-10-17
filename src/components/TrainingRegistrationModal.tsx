import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { registerForSession, registerForBundle, SessionUnavailableError, PAYMENT_PENDING_HOLD_MINUTES } from '@/lib/training'
import { createTicketCheckoutSession } from '@/lib/payments'
import { sendTrainingConfirmationEmail } from '@/lib/trainingConfirmationEmail'
import {
  queueTrainingPendingConfirmationEmail,
  queueBundlePendingConfirmationEmail,
  queueTrainingWaitlistEmail,
  queueBundleWaitlistEmail
} from '@/lib/email'
import { isSupportedLanguage } from '@/i18n'
import { Club, TrainingBundle, TrainingSeries, TrainingSession } from '@/types'

interface TrainingRegistrationModalProps {
  isOpen: boolean
  onClose: () => void
  club: Club
  session: TrainingSession & { id: string }
  // Set when the session belongs to a bundle — registration is against
  // the bundle (one signup covers every session it contains), not this
  // one occurrence (see TrainingBundle vs TrainingSeries in types).
  bundle?: (TrainingBundle & { id: string }) | null
  // Set when the session belongs to a recurring series — gives the
  // registration dialog a real event name to show instead of the generic
  // fallback title, same as `bundle` already does for a bundle session.
  series?: (TrainingSeries & { id: string }) | null
  // Signed-in ice-rink staff registering a customer manually (e.g. a
  // phone booking) skip the pending email-confirm window and go straight
  // to 'confirmed' — mirrors AdminCreateBookingModal for ice bookings.
  asStaff?: boolean
}

export default function TrainingRegistrationModal({ isOpen, onClose, club, session, bundle, series, asStaff }: TrainingRegistrationModalProps) {
  const { t, i18n } = useTranslation()
  const [formData, setFormData] = useState({ name: '', email: '', phone: '' })
  // A free event just asks for a plain headcount (no reason to tell
  // adults and children apart when there's no price difference) — see
  // isPriced below for when the form switches to the adult/child split
  // instead. attendeeCount itself is never its own state once priced;
  // it's always adultCount + childCount, computed where needed.
  const [attendeeCount, setAttendeeCount] = useState(1)
  const [adultCount, setAdultCount] = useState(1)
  const [childCount, setChildCount] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ status: 'pending' | 'confirmed' | 'waitlist' } | null>(null)

  const lang = isSupportedLanguage(i18n.language) ? i18n.language : 'en'
  // Price is only ever shown/charged once the club has actually turned
  // payments on — see CLAUDE.md's payment-scaffold note. Today that flag
  // stays off, so this branch never renders in production.
  const unitPrice = bundle ? bundle.price : session.price
  const isPriced = club.paymentsEnabled && unitPrice != null
  const unitChildPrice = (bundle ? bundle.childPrice : session.childPrice) ?? unitPrice ?? 0
  const discountPercent = Math.min(100, Math.max(0, (bundle ? bundle.discountPercent : session.discountPercent) ?? 0))
  const discountFactor = 1 - discountPercent / 100
  const effectiveAttendeeCount = isPriced ? adultCount + childCount : attendeeCount
  const adultLinePrice = unitPrice != null ? unitPrice * discountFactor : 0
  const childLinePrice = unitChildPrice * discountFactor
  const totalPrice = isPriced ? Math.round((adultCount * adultLinePrice + childCount * childLinePrice) * 100) / 100 : null

  const handleClose = () => {
    setFormData({ name: '', email: '', phone: '' })
    setAttendeeCount(1)
    setAdultCount(1)
    setChildCount(0)
    setError(null)
    setResult(null)
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (bundle) {
        const registered = await registerForBundle({
          clubId: club.id,
          bundleId: bundle.id,
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          instantConfirm: asStaff,
          language: lang,
          attendeeCount: effectiveAttendeeCount,
          ...(isPriced ? { adultCount, childCount } : {}),
          paymentsEnabled: club.paymentsEnabled,
          pendingHoldMinutes: totalPrice != null ? PAYMENT_PENDING_HOLD_MINUTES : undefined
        })
        // A priced registration (customer, not staff — see asStaff's own
        // doc comment) redirects to Stripe Checkout instead of sending any
        // email here: the webhook (functions/src/payments.ts) is the only
        // thing that ever queues the real confirmation email, once payment
        // actually succeeds. A waitlisted registration is excluded on
        // purpose — there's no guaranteed spot yet to charge for.
        if (!asStaff && totalPrice != null && registered.status !== 'waitlist') {
          const url = await createTicketCheckoutSession({ clubId: club.id, kind: 'bundle', registrationId: registered.id })
          window.location.href = url
          return
        }
        if (registered.status === 'confirmed') {
          await sendTrainingConfirmationEmail({ clubId: club.id, kind: 'bundle', registrationId: registered.id })
        } else if (registered.status === 'pending') {
          await queueBundlePendingConfirmationEmail(
            club,
            { registrationId: registered.id, cancellationToken: registered.cancellationToken, name: formData.name, email: formData.email, title: bundle.title, trainerName: bundle.trainerName },
            window.location.origin,
            lang
          )
        } else {
          await queueBundleWaitlistEmail(club, { name: formData.name, email: formData.email, title: bundle.title, trainerName: bundle.trainerName }, lang)
        }
        setResult({ status: registered.status })
      } else {
        const registered = await registerForSession({
          clubId: club.id,
          sessionId: session.id,
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          timezone: club.timezone,
          instantConfirm: asStaff,
          language: lang,
          attendeeCount: effectiveAttendeeCount,
          ...(isPriced ? { adultCount, childCount } : {}),
          paymentsEnabled: club.paymentsEnabled,
          pendingHoldMinutes: totalPrice != null ? PAYMENT_PENDING_HOLD_MINUTES : undefined
        })
        // See the bundle branch above for why a priced, non-staff,
        // non-waitlisted registration redirects instead of emailing here.
        if (!asStaff && totalPrice != null && registered.status !== 'waitlist') {
          const url = await createTicketCheckoutSession({ clubId: club.id, kind: 'session', registrationId: registered.id })
          window.location.href = url
          return
        }
        if (registered.status === 'confirmed') {
          await sendTrainingConfirmationEmail({ clubId: club.id, kind: 'session', registrationId: registered.id })
        } else if (registered.status === 'pending') {
          await queueTrainingPendingConfirmationEmail(
            club,
            { registrationId: registered.id, cancellationToken: registered.cancellationToken, name: formData.name, email: formData.email, date: session.date, startTime: session.startTime, durationMinutes: session.durationMinutes, trainerName: session.trainerName ?? '' },
            window.location.origin,
            lang
          )
        } else {
          await queueTrainingWaitlistEmail(club, { name: formData.name, email: formData.email, date: session.date, startTime: session.startTime, trainerName: session.trainerName ?? '' }, lang)
        }
        setResult({ status: registered.status })
      }
    } catch (err) {
      console.error('Error registering for training:', err)
      setError(err instanceof SessionUnavailableError ? t('trainingRegistration.unavailable') : t('common.error'))
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    const titleKey =
      result.status === 'confirmed' ? 'trainingRegistration.confirmedTitle'
      : result.status === 'pending' ? 'trainingRegistration.pendingTitle'
      : 'trainingRegistration.waitlistTitle'
    const noticeKey =
      result.status === 'confirmed' ? 'trainingRegistration.confirmedNotice'
      : result.status === 'pending' ? 'trainingRegistration.pendingNotice'
      : 'trainingRegistration.waitlistNotice'
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="bg-background-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-center text-2xl">{t(titleKey)}</DialogTitle>
          </DialogHeader>
          <p className="text-text-secondary text-center">{t(noticeKey)}</p>
          <DialogFooter>
            <Button onClick={handleClose} className="w-full">{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-background-card max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white text-lg">
            {bundle ? bundle.title : series ? series.title : t('trainingRegistration.title')}
          </DialogTitle>
        </DialogHeader>
        <div className="text-text-muted text-xs space-y-1 mb-2">
          <p>{bundle ? bundle.trainerName : session.trainerName}</p>
          {!bundle && <p>{t('common.dateAtTime', { date: session.date, startTime: session.startTime })}</p>}
          {asStaff && <p className="text-primary">{t('trainingRegistration.staffModeNotice')}</p>}
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-status-danger text-sm">{error}</p>}
          <div>
            <Label htmlFor="training-name" className="text-white">{t('common.name')}</Label>
            <Input id="training-name" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="bg-background-dark border-border text-white" />
          </div>
          <div>
            <Label htmlFor="training-email" className="text-white">{t('common.email')}</Label>
            <Input id="training-email" type="email" required value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="bg-background-dark border-border text-white" />
          </div>
          <div>
            <Label htmlFor="training-phone" className="text-white">{t('common.phone')}</Label>
            <Input id="training-phone" type="tel" required value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="bg-background-dark border-border text-white" />
          </div>
          {isPriced ? (
            <div className="flex gap-3">
              <div>
                <Label htmlFor="training-adult-count" className="text-white">{t('trainingRegistration.adultCount')}</Label>
                <Input
                  id="training-adult-count"
                  type="number"
                  min={0}
                  value={adultCount}
                  onChange={(e) => setAdultCount(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="bg-background-dark border-border text-white max-w-[100px]"
                />
              </div>
              <div>
                <Label htmlFor="training-child-count" className="text-white">{t('trainingRegistration.childCount')}</Label>
                <Input
                  id="training-child-count"
                  type="number"
                  min={0}
                  value={childCount}
                  onChange={(e) => setChildCount(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="bg-background-dark border-border text-white max-w-[100px]"
                />
              </div>
            </div>
          ) : (
            <div>
              <Label htmlFor="training-attendee-count" className="text-white">{t('booking.attendeeCount')}</Label>
              <Input
                id="training-attendee-count"
                type="number"
                min={1}
                value={attendeeCount}
                onChange={(e) => setAttendeeCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="bg-background-dark border-border text-white max-w-[100px]"
              />
            </div>
          )}
          {isPriced && (
            <div className="text-text-secondary text-sm space-y-0.5">
              {adultCount > 0 && <p>{t('trainingRegistration.priceAdultLine', { count: adultCount, price: adultLinePrice.toFixed(2) })}</p>}
              {childCount > 0 && <p>{t('trainingRegistration.priceChildLine', { count: childCount, price: childLinePrice.toFixed(2) })}</p>}
            </div>
          )}
          {totalPrice != null && (
            <p className="text-text-secondary text-sm font-semibold">{t('trainingRegistration.totalPrice', { amount: totalPrice.toFixed(2) })}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={submitting || effectiveAttendeeCount < 1} className="w-full bg-primary hover:bg-primary-gold text-primary-foreground">
              {submitting ? t('trainingRegistration.submitting') : t('trainingRegistration.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
