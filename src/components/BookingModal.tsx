import { useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { createBooking, SlotUnavailableError } from '@/lib/bookings'
import { queueBookingConfirmationEmail } from '@/lib/email'
import { Club, Zone } from '@/types'

interface BookingModalProps {
  club: Club
  zone: Zone
  date: string
  startTime: string
  durationMinutes: number
  isOpen: boolean
  onClose: () => void
  onBooked: () => void
}

export default function BookingModal({
  club,
  zone,
  date,
  startTime,
  durationMinutes,
  isOpen,
  onClose,
  onBooked
}: BookingModalProps) {
  const [formData, setFormData] = useState({ name: '', email: '', phone: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ confirmationCode: string; bookingId: string; cancellationToken: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!formData.name || !formData.email || !formData.phone) {
      setError('Please fill in all fields.')
      return
    }

    setSubmitting(true)
    try {
      const booking = await createBooking({
        clubId: club.id,
        zoneId: zone.id,
        date,
        startTime,
        durationMinutes,
        name: formData.name,
        email: formData.email,
        phone: formData.phone
      })
      setResult({
        confirmationCode: booking.confirmationCode,
        bookingId: booking.id,
        cancellationToken: booking.cancellationToken
      })
      queueBookingConfirmationEmail(
        club,
        zone,
        {
          bookingId: booking.id,
          cancellationToken: booking.cancellationToken,
          confirmationCode: booking.confirmationCode,
          date,
          startTime,
          durationMinutes,
          name: formData.name,
          email: formData.email
        },
        window.location.origin
      )
      onBooked()
    } catch (err) {
      if (err instanceof SlotUnavailableError) {
        setError(err.message)
      } else {
        console.error('Error creating booking:', err)
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    setResult(null)
    setFormData({ name: '', email: '', phone: '' })
    setError(null)
    onClose()
  }

  if (result) {
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="bg-background-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-center text-2xl">Booking confirmed</DialogTitle>
          </DialogHeader>
          <div className="py-6 space-y-4 text-center">
            <div>
              <div className="text-text-muted mb-2">Your confirmation code</div>
              <div className="text-primary text-4xl font-bold mono tracking-wider">
                {result.confirmationCode}
              </div>
            </div>
            <p className="text-text-secondary text-sm">
              We've emailed a confirmation with a link to manage or cancel this booking to{' '}
              {formData.email}.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={handleClose} className="w-full bg-primary hover:bg-primary-gold text-primary-foreground">
              Close
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
          <DialogTitle className="text-white text-xl">Book {zone.name}</DialogTitle>
          <div className="text-text-muted text-sm mt-2">
            {date} at {startTime} &middot; {durationMinutes} min
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {error && <div className="text-status-danger text-sm">{error}</div>}

          <div>
            <Label htmlFor="name" className="text-white">Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="bg-background-dark border-border text-white"
              required
            />
          </div>

          <div>
            <Label htmlFor="email" className="text-white">Email</Label>
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
            <Label htmlFor="phone" className="text-white">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="bg-background-dark border-border text-white"
              required
            />
          </div>

          <DialogFooter className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClose} className="flex-1 border-border text-white">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-primary hover:bg-primary-gold text-primary-foreground"
            >
              {submitting ? 'Booking...' : 'Confirm booking'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
