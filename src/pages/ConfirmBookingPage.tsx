import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useClubData } from '@/hooks/useClubData'
import { confirmBooking, BookingConfirmationError } from '@/lib/bookings'
import { queueBookingConfirmationEmail } from '@/lib/email'
import { isSupportedLanguage } from '@/i18n'
import { Booking, Zone } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import AddToCalendarButtons from '@/components/AddToCalendarButtons'
import { IcsEventInput } from '@/lib/ics'
import BackButton from '@/components/BackButton'

type State = 'confirming' | 'confirmed' | 'expired' | 'invalid' | 'error'

export default function ConfirmBookingPage() {
  const { t, i18n } = useTranslation()
  const { bookingId, token } = useParams<{ bookingId: string; token: string }>()
  const { club } = useClubData()
  const [state, setState] = useState<State>('confirming')
  const [booking, setBooking] = useState<(Booking & { id: string }) | null>(null)
  const [zone, setZone] = useState<Zone | null>(null)
  const ranRef = useRef(false)

  useEffect(() => {
    async function run() {
      if (!bookingId || !token || !club) return
      if (ranRef.current) return
      ranRef.current = true

      try {
        const { booking: confirmed, alreadyConfirmed } = await confirmBooking(bookingId, token)
        setBooking(confirmed)

        const zoneSnap = await getDoc(doc(db, 'zones', confirmed.zoneId))
        const zoneData = zoneSnap.exists() ? ({ id: zoneSnap.id, ...zoneSnap.data() } as Zone) : null
        setZone(zoneData)
        setState('confirmed')

        // Only send the real "booking confirmed" email (with calendar
        // attachment + cancel link) the first time this actually confirms
        // something — revisiting an already-confirmed link (double click,
        // reopened email) must not re-queue a duplicate.
        if (!alreadyConfirmed && zoneData) {
          queueBookingConfirmationEmail(
            club,
            zoneData,
            {
              bookingId,
              cancellationToken: confirmed.cancellationToken,
              confirmationCode: confirmed.confirmationCode,
              date: confirmed.date,
              startTime: confirmed.startTime,
              durationMinutes: confirmed.durationMinutes,
              name: confirmed.name,
              email: confirmed.email
            },
            window.location.origin,
            isSupportedLanguage(i18n.language) ? i18n.language : 'en'
          )
        }
      } catch (err) {
        if (err instanceof BookingConfirmationError) {
          setState(err.message === 'This booking has expired' ? 'expired' : 'invalid')
        } else {
          console.error('Error confirming booking:', err)
          setState('error')
        }
      }
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, token, club])

  const singleEvent: IcsEventInput | null =
    booking && zone && club
      ? {
          uid: `${booking.id}@${window.location.hostname}`,
          title: t('calendar.eventTitle', { club: club.name, zone: zone.name }),
          description: t('calendar.eventDescription', {
            code: booking.confirmationCode,
            url: `${window.location.origin}/my-booking/${booking.id}/${booking.cancellationToken}`
          }),
          location: club.contact.address || club.name,
          date: booking.date,
          startTime: booking.startTime,
          durationMinutes: booking.durationMinutes,
          timezone: club.timezone
        }
      : null

  return (
    <div className="content-container py-6 max-w-md mx-auto">
      <BackButton fallback="/" />
      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white">{t('confirmBooking.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {state === 'confirming' && <p className="text-text-muted">{t('common.loading')}</p>}
          {state === 'invalid' && <p className="text-status-danger">{t('confirmBooking.invalidLink')}</p>}
          {state === 'error' && <p className="text-status-danger">{t('common.error')}</p>}
          {state === 'expired' && (
            <div className="space-y-2">
              <p className="text-status-danger">{t('confirmBooking.expired')}</p>
              <p className="text-text-muted text-sm">{t('confirmBooking.expiredHint')}</p>
            </div>
          )}

          {state === 'confirmed' && booking && zone && club && (
            <div className="space-y-4 text-center">
              <p className="text-status-success">{t('confirmBooking.success')}</p>
              <div className="text-text-secondary space-y-1">
                <p><strong className="text-white">{zone.name}</strong></p>
                <p>{t('common.dateAtTime', { date: booking.date, startTime: booking.startTime })}</p>
                <p className="mono text-primary">{booking.confirmationCode}</p>
              </div>
              {singleEvent && <AddToCalendarButtons events={[singleEvent]} filename={`${club.name}-booking.ics`} />}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
