import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { formatDateISO } from '@/lib/utils'
import { Booking } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function AdminDashboardPage() {
  const { t } = useTranslation()
  const { staff, logout } = useAuth()
  const { club } = useClubData()
  const [todayBookings, setTodayBookings] = useState<(Booking & { id: string })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!club) return
    const todayISO = formatDateISO(new Date())
    getDocs(
      query(
        collection(db, 'bookings'),
        where('clubId', '==', club.id),
        where('date', '==', todayISO),
        orderBy('startTime', 'asc')
      )
    )
      .then((snap) => {
        setTodayBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Booking & { id: string }))
      })
      .finally(() => setLoading(false))
  }, [club])

  return (
    <div className="content-container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1>{t('admin.dashboardTitle')}</h1>
          <p className="text-text-secondary">{t('admin.signedInAs', { email: staff?.email })}</p>
        </div>
        <Button variant="outline" onClick={logout}>{t('admin.signOut')}</Button>
      </div>

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white">{t('admin.todaysBookings')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-text-muted">{t('common.loading')}</p>
          ) : todayBookings.length === 0 ? (
            <p className="text-text-muted">{t('admin.noBookingsToday')}</p>
          ) : (
            <div className="space-y-2">
              {todayBookings.map((b) => (
                <div key={b.id} className="flex justify-between border-b border-border py-2 text-sm">
                  <span className="mono text-primary">{b.startTime}</span>
                  <span className="text-white">{b.name}</span>
                  <span className={b.status === 'cancelled' ? 'text-status-muted' : 'text-status-success'}>
                    {b.status === 'cancelled' ? t('admin.statusCancelled') : t('admin.statusConfirmed')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-text-muted text-sm">{t('admin.followUpNote')}</p>
    </div>
  )
}
