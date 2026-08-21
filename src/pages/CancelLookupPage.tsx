import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useClubData } from '@/hooks/useClubData'
import { cancelBooking, isPastCancellationCutoff } from '@/lib/bookings'
import { queueCancellationEmail } from '@/lib/email'
import { isSupportedLanguage } from '@/i18n'
import { Booking, Zone } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import BackButton from '@/components/BackButton'

export default function CancelLookupPage() {
  const { t, i18n } = useTranslation()
  const { club } = useClubData()
  const [confirmationCode, setConfirmationCode] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'searching' | 'found' | 'cancelled' | 'not_found' | 'error'>('idle')
  const [booking, setBooking] = useState<(Booking & { id: string }) | null>(null)
  const [zone, setZone] = useState<Zone | null>(null)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!club) return
    setStatus('searching')

    const snap = await getDocs(
      query(
        collection(db, 'bookings'),
        where('clubId', '==', club.id),
        where('confirmationCode', '==', confirmationCode.trim()),
        where('email', '==', email.trim())
      )
    )

    if (snap.empty) {
      setStatus('not_found')
      return
    }

    const found = { id: snap.docs[0].id, ...snap.docs[0].data() } as Booking & { id: string }
    setBooking(found)

    const zoneSnap = await getDoc(doc(db, 'zones', found.zoneId))
    if (zoneSnap.exists()) setZone({ id: zoneSnap.id, ...zoneSnap.data() } as Zone)

    setStatus('found')
  }

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
      setStatus('cancelled')
    } catch (err) {
      console.error('Error cancelling booking:', err)
      setStatus('error')
    }
  }

  return (
    <div className="content-container py-6 max-w-md mx-auto">
      <BackButton fallback="/" />
      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white">{t('manageBooking.findTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'found' && booking && zone && club && (
            <div className="space-y-4">
              <div className="text-text-secondary space-y-1">
                <p><strong className="text-white">{zone.name}</strong></p>
                <p>{t('common.dateAtTime', { date: booking.date, startTime: booking.startTime })}</p>
                <p className="mono text-primary">{booking.confirmationCode}</p>
              </div>
              {booking.status === 'cancelled' ? (
                <p className="text-status-muted">{t('manageBooking.alreadyCancelled')}</p>
              ) : booking.status === 'pending' ? (
                <p className="text-status-muted text-sm">{t('manageBooking.awaitingConfirmation')}</p>
              ) : booking.status === 'expired' ? (
                <p className="text-status-muted text-sm">{t('manageBooking.confirmationExpired')}</p>
              ) : isPastCancellationCutoff(booking.date, booking.startTime, club.timezone) ? (
                <p className="text-status-muted text-sm">{t('manageBooking.cancellationLocked')}</p>
              ) : (
                <Button onClick={handleCancel} variant="destructive" className="w-full">
                  {t('manageBooking.cancelThisBooking')}
                </Button>
              )}
            </div>
          )}

          {status === 'cancelled' && (
            <p className="text-status-success">{t('manageBooking.cancelled')}</p>
          )}

          {status !== 'found' && status !== 'cancelled' && (
            <form onSubmit={handleSearch} className="space-y-4">
              {status === 'not_found' && (
                <p className="text-status-danger text-sm">{t('manageBooking.notFound')}</p>
              )}
              {status === 'error' && (
                <p className="text-status-danger text-sm">{t('common.error')}</p>
              )}
              <div>
                <Label htmlFor="code" className="text-white">{t('manageBooking.confirmationCode')}</Label>
                <Input
                  id="code"
                  value={confirmationCode}
                  onChange={(e) => setConfirmationCode(e.target.value)}
                  placeholder="203-776"
                  className="bg-background-dark border-border text-white"
                  required
                />
              </div>
              <div>
                <Label htmlFor="email" className="text-white">{t('common.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-background-dark border-border text-white"
                  required
                />
              </div>
              <Button type="submit" disabled={status === 'searching'} className="w-full bg-primary hover:bg-primary-gold text-primary-foreground">
                {status === 'searching' ? t('manageBooking.searching') : t('manageBooking.findBooking')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
