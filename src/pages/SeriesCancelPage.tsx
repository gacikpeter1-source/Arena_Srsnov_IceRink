import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useClubData } from '@/hooks/useClubData'
import { cancelBooking, cancelBookingSeries, fetchSeriesBookings, isPastCancellationCutoff } from '@/lib/bookings'
import { queueCancellationEmail, queueSeriesCancellationEmail } from '@/lib/email'
import { isSupportedLanguage } from '@/i18n'
import { Booking, BookingSeries, Zone } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import AddToCalendarButtons from '@/components/AddToCalendarButtons'
import { IcsEventInput } from '@/lib/ics'

type State = 'loading' | 'invalid' | 'expired' | 'ready' | 'error'

export default function SeriesCancelPage() {
  const { t, i18n } = useTranslation()
  const { seriesId, token } = useParams<{ seriesId: string; token: string }>()
  const { club } = useClubData()
  const [state, setState] = useState<State>('loading')
  const [series, setSeries] = useState<(BookingSeries & { id: string }) | null>(null)
  const [zone, setZone] = useState<Zone | null>(null)
  const [occurrences, setOccurrences] = useState<(Booking & { id: string })[]>([])
  const [cancellingAll, setCancellingAll] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      if (!seriesId || !token) {
        setState('invalid')
        return
      }
      const snap = await getDoc(doc(db, 'bookingSeries', seriesId))
      if (!snap.exists()) {
        setState('invalid')
        return
      }
      const found = { id: snap.id, ...snap.data() } as BookingSeries & { id: string }
      if (found.cancellationToken !== token) {
        setState('invalid')
        return
      }
      if (new Date(found.tokenExpiresAt as unknown as string) < new Date()) {
        setState('expired')
        return
      }
      setSeries(found)

      const zoneSnap = await getDoc(doc(db, 'zones', found.zoneId))
      if (zoneSnap.exists()) setZone({ id: zoneSnap.id, ...zoneSnap.data() } as Zone)

      setOccurrences(await fetchSeriesBookings(seriesId))
      setState('ready')
    }
    load()
  }, [seriesId, token])

  const lang = isSupportedLanguage(i18n.language) ? i18n.language : 'en'

  const handleCancelOne = async (booking: Booking & { id: string }) => {
    if (!club || !zone) return
    if (isPastCancellationCutoff(booking.date, booking.startTime, club.timezone)) return
    setCancellingId(booking.id)
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
        lang
      )
      setOccurrences((prev) => prev.map((o) => (o.id === booking.id ? { ...o, status: 'cancelled' } : o)))
    } catch (err) {
      console.error('Error cancelling occurrence:', err)
      setState('error')
    } finally {
      setCancellingId(null)
    }
  }

  const handleCancelAll = async () => {
    if (!series || !club || !zone) return
    setCancellingAll(true)
    try {
      const result = await cancelBookingSeries(series.id, club.timezone)
      if (result.cancelled > 0) {
        await queueSeriesCancellationEmail(
          club,
          zone,
          {
            name: series.name,
            email: series.email,
            startTime: series.startTime,
            durationMinutes: series.durationMinutes,
            cancelledCount: result.cancelled
          },
          lang
        )
      }
      setOccurrences(await fetchSeriesBookings(series.id))
    } catch (err) {
      console.error('Error cancelling series:', err)
      setState('error')
    } finally {
      setCancellingAll(false)
    }
  }

  const confirmedCount = occurrences.filter((o) => o.status === 'confirmed').length
  const cancellableCount = club
    ? occurrences.filter((o) => o.status === 'confirmed' && !isPastCancellationCutoff(o.date, o.startTime, club.timezone)).length
    : confirmedCount

  return (
    <div className="content-container py-6 max-w-md mx-auto">
      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white">{t('manageSeries.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {state === 'loading' && <p className="text-text-muted">{t('common.loading')}</p>}
          {state === 'invalid' && <p className="text-status-danger">{t('manageSeries.invalidLink')}</p>}
          {state === 'expired' && <p className="text-status-danger">{t('manageSeries.expiredLink')}</p>}
          {state === 'error' && <p className="text-status-danger">{t('common.error')}</p>}

          {state === 'ready' && series && zone && club && (
            <div className="space-y-4">
              <div className="text-text-secondary space-y-1">
                <p><strong className="text-white">{zone.name}</strong></p>
                <p>
                  {series.startTime} · {t('common.minutes', { count: series.durationMinutes })} ·{' '}
                  {t(series.frequency === 'daily' ? 'booking.frequencyDaily' : 'booking.frequencyWeekly')}
                </p>
              </div>

              <AddToCalendarButtons
                events={occurrences
                  .filter((o) => o.status === 'confirmed')
                  .map(
                    (o): IcsEventInput => ({
                      uid: `${o.id}@${window.location.hostname}`,
                      title: t('calendar.eventTitle', { club: club.name, zone: zone.name }),
                      description: t('calendar.eventDescription', {
                        code: o.confirmationCode,
                        url: window.location.href
                      }),
                      location: club.contact.address || club.name,
                      date: o.date,
                      startTime: o.startTime,
                      durationMinutes: o.durationMinutes,
                      timezone: club.timezone
                    })
                  )}
                filename={`${club.name}-sessions.ics`}
              />

              <div>
                <h3 className="text-white text-sm font-semibold mb-2">{t('manageSeries.occurrencesTitle')}</h3>
                <ul className="space-y-2">
                  {occurrences.map((o) => {
                    const locked = o.status === 'confirmed' && isPastCancellationCutoff(o.date, o.startTime, club.timezone)
                    return (
                      <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className={o.status === 'cancelled' ? 'text-text-muted line-through' : 'text-text-secondary'}>
                          {o.date}
                        </span>
                        {o.status === 'confirmed' ? (
                          locked ? (
                            <span className="text-status-muted text-xs">{t('manageSeries.occurrenceLocked')}</span>
                          ) : (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={cancellingId === o.id || cancellingAll}
                              onClick={() => handleCancelOne(o)}
                            >
                              {t('manageSeries.cancelOccurrence')}
                            </Button>
                          )
                        ) : (
                          <span className="text-status-muted text-xs">{t('admin.statusCancelled')}</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>

              {cancellableCount > 0 ? (
                <Button onClick={handleCancelAll} variant="destructive" className="w-full" disabled={cancellingAll}>
                  {t('manageSeries.cancelSeries')}
                </Button>
              ) : confirmedCount > 0 ? (
                <p className="text-status-muted text-sm">{t('manageBooking.cancellationLocked')}</p>
              ) : (
                <p className="text-status-muted text-sm">{t('manageSeries.allCancelled')}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
