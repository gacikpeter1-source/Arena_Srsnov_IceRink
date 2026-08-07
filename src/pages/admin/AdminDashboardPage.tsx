import { useEffect, useState } from 'react'
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { formatDateISO } from '@/lib/utils'
import { Booking } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function AdminDashboardPage() {
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
          <h1>Admin dashboard</h1>
          <p className="text-text-secondary">Signed in as {staff?.email}</p>
        </div>
        <Button variant="outline" onClick={logout}>Sign out</Button>
      </div>

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white">Today's bookings</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-text-muted">Loading...</p>
          ) : todayBookings.length === 0 ? (
            <p className="text-text-muted">No bookings today.</p>
          ) : (
            <div className="space-y-2">
              {todayBookings.map((b) => (
                <div key={b.id} className="flex justify-between border-b border-border py-2 text-sm">
                  <span className="mono text-primary">{b.startTime}</span>
                  <span className="text-white">{b.name}</span>
                  <span className={b.status === 'cancelled' ? 'text-status-muted' : 'text-status-success'}>
                    {b.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-text-muted text-sm">
        Zone/hours management and manual booking creation are follow-up work — this is a read-only
        starting point.
      </p>
    </div>
  )
}
