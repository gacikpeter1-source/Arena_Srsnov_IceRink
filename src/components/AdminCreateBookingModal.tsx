import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { createBooking, SlotUnavailableError } from '@/lib/bookings'
import { computeDaySchedule } from '@/lib/schedule'
import { formatDateISO } from '@/lib/utils'
import { Club, DivisionRule, TimeSlotConfig, Zone } from '@/types'

interface AdminCreateBookingModalProps {
  club: Club
  zones: Zone[]
  timeSlotConfig: TimeSlotConfig
  divisionRules: DivisionRule[]
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
}

export default function AdminCreateBookingModal({
  club,
  zones,
  timeSlotConfig,
  divisionRules,
  isOpen,
  onClose,
  onCreated
}: AdminCreateBookingModalProps) {
  const { t } = useTranslation()
  const [date, setDate] = useState(formatDateISO(new Date()))
  const [startTime, setStartTime] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [formData, setFormData] = useState({ name: '', email: '', phone: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const schedule = useMemo(
    () => computeDaySchedule(new Date(`${date}T00:00:00`), timeSlotConfig, divisionRules, zones),
    [date, timeSlotConfig, divisionRules, zones]
  )

  const zoneOptions = schedule.find((s) => s.time === startTime)?.zones ?? []

  const handleClose = () => {
    setDate(formatDateISO(new Date()))
    setStartTime('')
    setZoneId('')
    setFormData({ name: '', email: '', phone: '' })
    setError(null)
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!startTime || !zoneId || !formData.name || !formData.email || !formData.phone) {
      setError(t('booking.fillAllFields'))
      return
    }

    setSubmitting(true)
    try {
      await createBooking({
        clubId: club.id,
        zoneId,
        date,
        startTime,
        durationMinutes: timeSlotConfig.slotDurationMinutes,
        name: formData.name,
        email: formData.email,
        phone: formData.phone
      })
      onCreated()
      handleClose()
    } catch (err) {
      setError(err instanceof SlotUnavailableError ? t('booking.slotUnavailable') : t('common.error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-background-card max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white text-xl">{t('admin.newReservation')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {error && <div className="text-status-danger text-sm">{error}</div>}

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
