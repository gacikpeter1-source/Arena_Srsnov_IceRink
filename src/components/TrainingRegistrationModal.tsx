import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { registerForSession, registerForBundle, SessionUnavailableError } from '@/lib/training'
import { queueTrainingPendingConfirmationEmail, queueBundlePendingConfirmationEmail, queueTrainingWaitlistEmail, queueBundleWaitlistEmail } from '@/lib/email'
import { isSupportedLanguage } from '@/i18n'
import { Club, TrainingBundle, TrainingSession } from '@/types'

interface TrainingRegistrationModalProps {
  isOpen: boolean
  onClose: () => void
  club: Club
  session: TrainingSession & { id: string }
  // Set when the session belongs to a bundle — registration is against
  // the bundle (one signup covers every session it contains), not this
  // one occurrence (see TrainingBundle vs TrainingSeries in types).
  bundle?: (TrainingBundle & { id: string }) | null
}

export default function TrainingRegistrationModal({ isOpen, onClose, club, session, bundle }: TrainingRegistrationModalProps) {
  const { t, i18n } = useTranslation()
  const [formData, setFormData] = useState({ name: '', email: '', phone: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ status: 'pending' | 'waitlist' } | null>(null)

  const lang = isSupportedLanguage(i18n.language) ? i18n.language : 'en'

  const handleClose = () => {
    setFormData({ name: '', email: '', phone: '' })
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
          phone: formData.phone
        })
        if (registered.status === 'pending') {
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
          timezone: club.timezone
        })
        if (registered.status === 'pending') {
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
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="bg-background-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-center text-2xl">
              {result.status === 'pending' ? t('trainingRegistration.pendingTitle') : t('trainingRegistration.waitlistTitle')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-text-secondary text-center">
            {result.status === 'pending' ? t('trainingRegistration.pendingNotice') : t('trainingRegistration.waitlistNotice')}
          </p>
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
          <DialogTitle className="text-white">{bundle ? bundle.title : t('trainingRegistration.title')}</DialogTitle>
        </DialogHeader>
        <div className="text-text-secondary text-sm space-y-1 mb-2">
          <p>{bundle ? bundle.trainerName : session.trainerName}</p>
          {!bundle && <p>{t('common.dateAtTime', { date: session.date, startTime: session.startTime })}</p>}
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
          <DialogFooter>
            <Button type="submit" disabled={submitting} className="w-full bg-primary hover:bg-primary-gold text-primary-foreground">
              {submitting ? t('trainingRegistration.submitting') : t('trainingRegistration.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
