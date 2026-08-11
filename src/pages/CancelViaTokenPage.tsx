import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useClubData } from '@/hooks/useClubData'
import { cancelBooking, isPastCancellationCutoff } from '@/lib/bookings'
import { queueCancellationEmail } from '@/lib/email'
import { isSupportedLanguage } from '@/i18n'
import { Booking, Zone } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import AddToCalendarButtons from '@/components/AddToCalendarButtons'

type State = 'loading' | 'invalid' | 'expired' | 'ready' | 'already_cancelled' | 'cancelled' | 'error'

export default function CancelViaTokenPage() {
  const { t, i18n } = useTranslation()
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
      await queueCancellationEmail(
        club,
        zone,
        {
          name: booking.name,
          email: booking.email,
          date: booking.date,
          startTime: booking.startTime,
          durationMinutes: booking.durationMinutes,
          confirmationCode: booking.confirmationCode
        },
        isSupportedLanguage(i18n.language) ? i18n.language : 'en'
      )
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
          <CardTitle className="text-white">{t('manageBooking.manageTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {state === 'loading' && <p className="text-text-muted">{t('common.loading')}</p>}
          {state === 'invalid' && <p className="text-status-danger">{t('manageBooking.invalidLink')}</p>}
          {state === 'expired' && <p className="text-status-danger">{t('manageBooking.expiredLink')}</p>}
          {state === 'error' && <p className="text-status-danger">{t('common.error')}</p>}
          {state === 'already_cancelled' && <p className="text-status-muted">{t('manageBooking.alreadyCancelled')}</p>}
          {state === 'cancelled' && <p className="text-status-success">{t('manageBooking.cancelled')}</p>}

          {state === 'ready' && booking && zone && club && (
            <div className="space-y-4">
              <div className="text-text-secondary space-y-1">
                <p><strong className="text-white">{zone.name}</strong></p>
                <p>{t('common.dateAtTime', { date: booking.date, startTime: booking.startTime })}</p>
                <p className="mono text-primary">{booking.confirmationCode}</p>
              </div>
              <AddToCalendarButtons
                events={[
                  {
                    uid: `${booking.id}@${window.location.hostname}`,
                    title: t('calendar.eventTitle', { club: club.name, zone: zone.name }),
                    description: t('calendar.eventDescription', {
                      code: booking.confirmationCode,
                      url: window.location.href
                    }),
                    location: club.contact.address || club.name,
                    date: booking.date,
                    startTime: booking.startTime,
                    durationMinutes: booking.durationMinutes,
                    timezone: club.timezone
                  }
                ]}
                filename={`${club.name}-booking.ics`}
              />
              {isPastCancellationCutoff(booking.date, booking.startTime, club.timezone) ? (
                <p className="text-status-muted text-sm">{t('manageBooking.cancellationLocked')}</p>
              ) : (
                <Button onClick={handleCancel} variant="destructive" className="w-full">
                  {t('manageBooking.cancelThisBooking')}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
