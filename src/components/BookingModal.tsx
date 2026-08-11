import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  createBooking,
  createBookingSeries,
  PENDING_CONFIRMATION_MINUTES,
  SeriesRecurrence,
  SERIES_MAX_OCCURRENCES,
  SlotUnavailableError,
  type CreatedSeries
} from '@/lib/bookings'
import { queuePendingConfirmationEmail, queueSeriesConfirmationEmail } from '@/lib/email'
import { isSupportedLanguage } from '@/i18n'
import { addDays, formatDateISO } from '@/lib/utils'
import { IcsEventInput } from '@/lib/ics'
import AddToCalendarButtons from './AddToCalendarButtons'
import { Club, SeriesFrequency, Zone } from '@/types'

interface BookingModalProps {
  club: Club
  rinkId: string
  zone: Zone
  date: string
  startTime: string
  durationMinutes: number
  isOpen: boolean
  onClose: () => void
  onBooked: () => void
}

const MIN_SERIES_COUNT = 2

export default function BookingModal({
  club,
  rinkId,
  zone,
  date,
  startTime,
  durationMinutes,
  isOpen,
  onClose,
  onBooked
}: BookingModalProps) {
  const { t, i18n } = useTranslation()
  const [formData, setFormData] = useState({ name: '', email: '', phone: '' })
  const [repeat, setRepeat] = useState(false)
  const [frequency, setFrequency] = useState<SeriesFrequency>('weekly')
  const [recurrenceType, setRecurrenceType] = useState<'count' | 'until'>('count')
  const [count, setCount] = useState(4)
  const [untilDate, setUntilDate] = useState(() => formatDateISO(addDays(new Date(`${date}T00:00:00`), 28)))

  const handleFrequencyChange = (next: SeriesFrequency) => {
    setFrequency(next)
    setCount((c) => Math.min(c, SERIES_MAX_OCCURRENCES[next]))
  }
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ bookingId: string; confirmationCode: string; cancellationToken: string } | null>(null)
  const [seriesResult, setSeriesResult] = useState<CreatedSeries | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!formData.name || !formData.email || !formData.phone) {
      setError(t('booking.fillAllFields'))
      return
    }

    setSubmitting(true)
    try {
      const lang = isSupportedLanguage(i18n.language) ? i18n.language : 'en'

      if (repeat) {
        const recurrence: SeriesRecurrence =
          recurrenceType === 'count'
            ? { type: 'count', frequency, count }
            : { type: 'until', frequency, endDate: untilDate }
        const series = await createBookingSeries({
          clubId: club.id,
          rinkId,
          zoneId: zone.id,
          startDate: date,
          startTime,
          durationMinutes,
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          timezone: club.timezone,
          recurrence
        })
        setSeriesResult(series)
        queueSeriesConfirmationEmail(
          club,
          zone,
          {
            seriesId: series.seriesId,
            cancellationToken: series.cancellationToken,
            startTime,
            durationMinutes,
            name: formData.name,
            email: formData.email,
            created: series.created,
            skippedDates: series.skippedDates
          },
          window.location.origin,
          lang
        )
      } else {
        const booking = await createBooking({
          clubId: club.id,
          rinkId,
          zoneId: zone.id,
          date,
          startTime,
          durationMinutes,
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          timezone: club.timezone,
          requiresConfirmation: true
        })
        setResult({
          bookingId: booking.id,
          confirmationCode: booking.confirmationCode,
          cancellationToken: booking.cancellationToken
        })
        queuePendingConfirmationEmail(
          club,
          zone,
          {
            bookingId: booking.id,
            cancellationToken: booking.cancellationToken,
            date,
            startTime,
            durationMinutes,
            name: formData.name,
            email: formData.email
          },
          window.location.origin,
          lang
        )
      }
      onBooked()
    } catch (err) {
      if (err instanceof SlotUnavailableError) {
        setError(repeat ? t('booking.seriesUnavailable') : t('booking.slotUnavailable'))
      } else {
        console.error('Error creating booking:', err)
        setError(t('common.error'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    setResult(null)
    setSeriesResult(null)
    setFormData({ name: '', email: '', phone: '' })
    setRepeat(false)
    setFrequency('weekly')
    setError(null)
    onClose()
  }

  if (seriesResult) {
    const seriesEvents: IcsEventInput[] = seriesResult.created.map((o) => ({
      uid: `${o.bookingId}@${window.location.hostname}`,
      title: t('calendar.eventTitle', { club: club.name, zone: zone.name }),
      description: t('calendar.eventDescription', {
        code: o.confirmationCode,
        url: `${window.location.origin}/my-series/${seriesResult.seriesId}/${seriesResult.cancellationToken}`
      }),
      location: club.contact.address || club.name,
      date: o.date,
      startTime,
      durationMinutes,
      timezone: club.timezone
    }))

    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="bg-background-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-center text-2xl">{t('booking.seriesConfirmed')}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-text-secondary text-sm text-center">
              {t('booking.seriesConfirmedCount', { count: seriesResult.created.length })}
            </p>
            <ul className="text-sm text-text-secondary space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
              {seriesResult.created.map((o) => (
                <li key={o.bookingId} className="flex justify-between">
                  <span>{o.date}</span>
                  <span className="mono text-primary">{o.confirmationCode}</span>
                </li>
              ))}
            </ul>
            {seriesResult.skippedDates.length > 0 && (
              <div className="text-sm text-status-danger">
                <p>{t('booking.seriesSkippedIntro')}</p>
                <ul className="list-disc list-inside">
                  {seriesResult.skippedDates.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            )}
            <AddToCalendarButtons events={seriesEvents} filename={`${club.name}-sessions.ics`} />
            <p className="text-text-secondary text-sm text-center">
              {t('booking.emailedNotice', { email: formData.email })}
            </p>
          </div>
          <DialogFooter>
            <Button onClick={handleClose} className="w-full bg-primary hover:bg-primary-gold text-primary-foreground">
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  if (result) {
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="bg-background-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-center text-2xl">{t('booking.pendingTitle')}</DialogTitle>
          </DialogHeader>
          <div className="py-6 space-y-4 text-center">
            <div>
              <div className="text-text-muted mb-2">{t('booking.yourCode')}</div>
              <div className="text-primary text-4xl font-bold mono tracking-wider">
                {result.confirmationCode}
              </div>
            </div>
            <p className="text-text-secondary text-sm">
              {t('booking.pendingIntro', { email: formData.email, count: PENDING_CONFIRMATION_MINUTES })}
            </p>
            <p className="text-text-muted text-xs">{t('booking.pendingExpiryNotice')}</p>
          </div>
          <DialogFooter>
            <Button onClick={handleClose} className="w-full bg-primary hover:bg-primary-gold text-primary-foreground">
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-background-card max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white text-xl">{t('booking.bookZone', { zone: zone.name })}</DialogTitle>
          <div className="text-text-muted text-sm mt-2">
            {t('booking.slotInfo', { date, startTime, duration: t('common.minutes', { count: durationMinutes }) })}
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {error && <div className="text-status-danger text-sm">{error}</div>}

          <div>
            <Label htmlFor="name" className="text-white">{t('common.name')}</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="bg-background-dark border-border text-white"
              required
            />
          </div>

          <div>
            <Label htmlFor="email" className="text-white">{t('common.email')}</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="bg-background-dark border-border text-white"
              required
            />
          </div>

          <div>
            <Label htmlFor="phone" className="text-white">{t('common.phone')}</Label>
            <Input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="bg-background-dark border-border text-white"
              required
            />
          </div>

          {!repeat && (
            <p className="text-text-muted text-xs">
              {t('booking.confirmationNotice', { count: PENDING_CONFIRMATION_MINUTES })}
            </p>
          )}

          <div className="border-t border-border pt-4">
            <label className="flex items-center gap-2 text-white text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={repeat}
                onChange={(e) => setRepeat(e.target.checked)}
                className="h-4 w-4"
              />
              {t('booking.repeatBooking')}
            </label>

            {repeat && (
              <div className="mt-3 space-y-3 pl-6">
                <div className="flex gap-4 text-sm text-white">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="frequency"
                      checked={frequency === 'daily'}
                      onChange={() => handleFrequencyChange('daily')}
                    />
                    {t('booking.frequencyDaily')}
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="frequency"
                      checked={frequency === 'weekly'}
                      onChange={() => handleFrequencyChange('weekly')}
                    />
                    {t('booking.frequencyWeekly')}
                  </label>
                </div>

                <div className="flex gap-4 text-sm text-white">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="recurrenceType"
                      checked={recurrenceType === 'count'}
                      onChange={() => setRecurrenceType('count')}
                    />
                    {t('booking.recurrenceForCount')}
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="recurrenceType"
                      checked={recurrenceType === 'until'}
                      onChange={() => setRecurrenceType('until')}
                    />
                    {t('booking.recurrenceUntilDate')}
                  </label>
                </div>

                {recurrenceType === 'count' ? (
                  <div>
                    <Label htmlFor="series-count" className="text-white">{t('booking.numberOfOccurrences')}</Label>
                    <Input
                      id="series-count"
                      type="number"
                      min={MIN_SERIES_COUNT}
                      max={SERIES_MAX_OCCURRENCES[frequency]}
                      value={count}
                      onChange={(e) => setCount(Number(e.target.value))}
                      className="bg-background-dark border-border text-white max-w-[120px]"
                    />
                  </div>
                ) : (
                  <div>
                    <Label htmlFor="series-until" className="text-white">{t('booking.repeatUntil')}</Label>
                    <Input
                      id="series-until"
                      type="date"
                      min={date}
                      max={formatDateISO(
                        addDays(new Date(`${date}T00:00:00`), (SERIES_MAX_OCCURRENCES[frequency] - 1) * (frequency === 'daily' ? 1 : 7))
                      )}
                      value={untilDate}
                      onChange={(e) => setUntilDate(e.target.value)}
                      className="bg-background-dark border-border text-white"
                    />
                  </div>
                )}
                <p className="text-text-muted text-xs">{t('booking.repeatNotice')}</p>
              </div>
            )}
          </div>

          <DialogFooter className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClose} className="flex-1 border-border text-white">
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-primary hover:bg-primary-gold text-primary-foreground"
            >
              {submitting ? t('booking.booking') : t('booking.confirmBooking')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
