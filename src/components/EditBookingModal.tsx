import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { updateBookingContact } from '@/lib/bookings'
import { Booking } from '@/types'

interface EditBookingModalProps {
  booking: (Booking & { id: string }) | null
  onClose: () => void
  onSaved: () => void
}

export default function EditBookingModal({ booking, onClose, onSaved }: EditBookingModalProps) {
  const { t } = useTranslation()
  const [formData, setFormData] = useState({ name: '', email: '', phone: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (booking) {
      setFormData({ name: booking.name, email: booking.email, phone: booking.phone })
      setError(null)
    }
  }, [booking])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!booking) return
    setError(null)

    if (!formData.name || !formData.email || !formData.phone) {
      setError(t('booking.fillAllFields'))
      return
    }

    setSubmitting(true)
    try {
      await updateBookingContact(booking.id, formData)
      onSaved()
      onClose()
    } catch (err) {
      console.error('Error updating booking contact:', err)
      setError(t('common.error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={Boolean(booking)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-background-card max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white text-xl">{t('admin.editReservation')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {error && <div className="text-status-danger text-sm">{error}</div>}

          <div>
            <Label htmlFor="edit-name" className="text-white">{t('common.name')}</Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="bg-background-dark border-border text-white"
              required
            />
          </div>

          <div>
            <Label htmlFor="edit-email" className="text-white">{t('common.email')}</Label>
            <Input
              id="edit-email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="bg-background-dark border-border text-white"
              required
            />
          </div>

          <div>
            <Label htmlFor="edit-phone" className="text-white">{t('common.phone')}</Label>
            <Input
              id="edit-phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="bg-background-dark border-border text-white"
              required
            />
          </div>

          <DialogFooter className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 border-border text-white">
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={submitting} className="flex-1 bg-primary hover:bg-primary-gold text-primary-foreground">
              {submitting ? t('booking.booking') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
