import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useClubData } from '@/hooks/useClubData'
import { cancelBooking } from '@/lib/bookings'
import { queueCancellationEmail } from '@/lib/email'
import { Booking, Zone } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type State = 'loading' | 'invalid' | 'expired' | 'ready' | 'already_cancelled' | 'cancelled' | 'error'

export default function CancelViaTokenPage() {
  const { bookingId, token } = useParams<{ bookingId: string; token: string }>()
  const { club } = useClubData()
  const [state, setState] = useState<State>('loading')
  const [booking, setBooking] = useState<(Booking & { id: string }) | null>(null)
  const [zone, setZone] = useState<Zone | null>(null)

  useEffect(() => {
    async function load() {
      if (!bookingId || !token) {
        setState('invalid')
        return
      }
      const snap = await getDoc(doc(db, 'bookings', bookingId))
      if (!snap.exists()) {
        setState('invalid')
        return
      }
      const found = { id: snap.id, ...snap.data() } as Booking & { id: string }
      if (found.cancellationToken !== token) {
        setState('invalid')
        return
      }
      if (new Date(found.tokenExpiresAt as unknown as string) < new Date()) {
        setState('expired')
        return
      }
      setBooking(found)

      const zoneSnap = await getDoc(doc(db, 'zones', found.zoneId))
      if (zoneSnap.exists()) setZone({ id: zoneSnap.id, ...zoneSnap.data() } as Zone)

      setState(found.status === 'cancelled' ? 'already_cancelled' : 'ready')
    }
    load()
  }, [bookingId, token])

  const handleCancel = async () => {
    if (!booking || !club || !zone) return
    try {
      await cancelBooking(booking.id)
      await queueCancellationEmail(club, zone, {
        name: booking.name,
        email: booking.email,
        date: booking.date,
        startTime: booking.startTime,
        durationMinutes: booking.durationMinutes,
        confirmationCode: booking.confirmationCode
      })
      setState('cancelled')
    } catch (err) {
      console.error('Error cancelling booking:', err)
      setState('error')
    }
  }

  return (
    <div className="content-container py-6 max-w-md mx-auto">
      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white">Manage booking</CardTitle>
        </CardHeader>
        <CardContent>
          {state === 'loading' && <p className="text-text-muted">Loading...</p>}
          {state === 'invalid' && <p className="text-status-danger">This link is invalid.</p>}
          {state === 'expired' && <p className="text-status-danger">This link has expired.</p>}
          {state === 'error' && <p className="text-status-danger">Something went wrong. Please try again.</p>}
          {state === 'already_cancelled' && <p className="text-status-muted">This booking is already cancelled.</p>}
          {state === 'cancelled' && <p className="text-status-success">Your booking has been cancelled.</p>}

          {state === 'ready' && booking && zone && (
            <div className="space-y-4">
              <div className="text-text-secondary space-y-1">
                <p><strong className="text-white">{zone.name}</strong></p>
                <p>{booking.date} at {booking.startTime}</p>
                <p className="mono text-primary">{booking.confirmationCode}</p>
              </div>
              <Button onClick={handleCancel} variant="destructive" className="w-full">
                Cancel this booking
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
