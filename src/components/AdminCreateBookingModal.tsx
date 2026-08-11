import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  createBooking,
  createBookingSeries,
  SeriesRecurrence,
  SERIES_MAX_OCCURRENCES,
  SlotUnavailableError,
  type CreatedSeries
} from '@/lib/bookings'
import { computeDaySchedule } from '@/lib/schedule'
import { addDays, formatDateISO } from '@/lib/utils'
import { Club, DivisionRule, Rink, SeriesFrequency, TimeSlotConfig, Zone } from '@/types'

interface AdminCreateBookingModalProps {
  club: Club
  rinks: Rink[]
  zones: Zone[]
  timeSlotConfigs: TimeSlotConfig[]
  divisionRules: DivisionRule[]
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
}

const MIN_SERIES_COUNT = 2

export default function AdminCreateBookingModal({
  club,
  rinks,
  zones,
  timeSlotConfigs,
  divisionRules,
  isOpen,
  onClose,
  onCreated
}: AdminCreateBookingModalProps) {
  const { t } = useTranslation()
  const [rinkId, setRinkId] = useState(() => rinks[0]?.id ?? '')
  const [date, setDate] = useState(formatDateISO(new Date()))
  const [startTime, setStartTime] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [formData, setFormData] = useState({ name: '', email: '', phone: '' })
  const [repeat, setRepeat] = useState(false)
  const [frequency, setFrequency] = useState<SeriesFrequency>('weekly')
  const [recurrenceType, setRecurrenceType] = useState<'count' | 'until'>('count')
  const [count, setCount] = useState(4)
  const [untilDate, setUntilDate] = useState(() => formatDateISO(addDays(new Date(), 28)))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seriesResult, setSeriesResult] = useState<CreatedSeries | null>(null)

  const handleFrequencyChange = (next: SeriesFrequency) => {
    setFrequency(next)
    setCount((c) => Math.min(c, SERIES_MAX_OCCURRENCES[next]))
  }

  const rinkZones = useMemo(() => zones.filter((z) => z.rinkId === rinkId), [zones, rinkId])
  const rinkRules = useMemo(() => divisionRules.filter((r) => r.rinkId === rinkId), [divisionRules, rinkId])
  const timeSlotConfig = timeSlotConfigs.find((c) => c.rinkId === rinkId) ?? null

  const schedule = useMemo(
    () => (timeSlotConfig ? computeDaySchedule(new Date(`${date}T00:00:00`), timeSlotConfig, rinkRules, rinkZones) : []),
    [date, timeSlotConfig, rinkRules, rinkZones]
  )

  const zoneOptions = schedule.find((s) => s.time === startTime)?.zones ?? []

  const resetForm = () => {
    setRinkId(rinks[0]?.id ?? '')
    setDate(formatDateISO(new Date()))
    setStartTime('')
    setZoneId('')
    setFormData({ name: '', email: '', phone: '' })
    setRepeat(false)
    setFrequency('weekly')
    setError(null)
    setSeriesResult(null)
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!rinkId || !startTime || !zoneId || !formData.name || !formData.email || !formData.phone || !timeSlotConfig) {
      setError(t('booking.fillAllFields'))
      return
    }

    setSubmitting(true)
    try {
      if (repeat) {
        const recurrence: SeriesRecurrence =
          recurrenceType === 'count'
            ? { type: 'count', frequency, count }
            : { type: 'until', frequency, endDate: untilDate }
        const series = await createBookingSeries({
          clubId: club.id,
          rinkId,
          zoneId,
          startDate: date,
          startTime,
          durationMinutes: timeSlotConfig.slotDurationMinutes,
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          timezone: club.timezone,
          recurrence
        })
        setSeriesResult(series)
        onCreated()
      } else {
        await createBooking({
          clubId: club.id,
          rinkId,
          zoneId,
          date,
          startTime,
          durationMinutes: timeSlotConfig.slotDurationMinutes,
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          timezone: club.timezone
        })
        onCreated()
        handleClose()
      }
    } catch (err) {
      setError(
        err instanceof SlotUnavailableError
          ? repeat
            ? t('booking.seriesUnavailable')
            : t('booking.slotUnavailable')
          : t('common.error')
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (seriesResult) {
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="bg-background-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">{t('booking.seriesConfirmed')}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-text-secondary text-sm">
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
          <DialogTitle className="text-white text-xl">{t('admin.newReservation')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {error && <div className="text-status-danger text-sm">{error}</div>}

          {rinks.length > 1 && (
            <div>
              <Label htmlFor="admin-rink" className="text-white">{t('admin.rink')}</Label>
              <select
                id="admin-rink"
                value={rinkId}
                onChange={(e) => {
                  setRinkId(e.target.value)
                  setStartTime('')
                  setZoneId('')
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background-dark px-3 py-2 text-sm text-white"
                required
              >
                <option value="">{t('admin.selectRink')}</option>
                {rinks.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <Label htmlFor="admin-date" className="text-white">{t('admin.date')}</Label>
            <Input
              id="admin-date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                setStartTime('')
                setZoneId('')
              }}
              className="bg-background-dark border-border text-white"
              required
            />
          </div>

          <div>
            <Label htmlFor="admin-time" className="text-white">{t('admin.time')}</Label>
            <select
              id="admin-time"
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value)
                setZoneId('')
              }}
              className="flex h-10 w-full rounded-md border border-input bg-background-dark px-3 py-2 text-sm text-white"
              required
              disabled={!rinkId}
            >
              <option value="">{t('admin.selectTime')}</option>
              {schedule.map((s) => (
                <option key={s.time} value={s.time}>{s.time}</option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="admin-zone" className="text-white">{t('admin.zone')}</Label>
            <select
              id="admin-zone"
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background-dark px-3 py-2 text-sm text-white"
              required
              disabled={!startTime}
            >
              <option value="">{t('admin.selectZone')}</option>
              {zoneOptions.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="admin-name" className="text-white">{t('common.name')}</Label>
            <Input
              id="admin-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="bg-background-dark border-border text-white"
              required
            />
          </div>

          <div>
            <Label htmlFor="admin-email" className="text-white">{t('common.email')}</Label>
            <Input
              id="admin-email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="bg-background-dark border-border text-white"
              required
            />
          </div>

          <div>
            <Label htmlFor="admin-phone" className="text-white">{t('common.phone')}</Label>
            <Input
              id="admin-phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="bg-background-dark border-border text-white"
              required
            />
          </div>

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
                      name="admin-frequency"
                      checked={frequency === 'daily'}
                      onChange={() => handleFrequencyChange('daily')}
                    />
                    {t('booking.frequencyDaily')}
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="admin-frequency"
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
                      name="admin-recurrenceType"
                      checked={recurrenceType === 'count'}
                      onChange={() => setRecurrenceType('count')}
                    />
                    {t('booking.recurrenceForCount')}
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="admin-recurrenceType"
                      checked={recurrenceType === 'until'}
                      onChange={() => setRecurrenceType('until')}
                    />
                    {t('booking.recurrenceUntilDate')}
                  </label>
                </div>

                {recurrenceType === 'count' ? (
                  <div>
                    <Label htmlFor="admin-series-count" className="text-white">{t('booking.numberOfOccurrences')}</Label>
                    <Input
                      id="admin-series-count"
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
                    <Label htmlFor="admin-series-until" className="text-white">{t('booking.repeatUntil')}</Label>
                    <Input
                      id="admin-series-until"
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
            <Button type="submit" disabled={submitting} className="flex-1 bg-primary hover:bg-primary-gold text-primary-foreground">
              {submitting ? t('booking.booking') : t('admin.createReservation')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
