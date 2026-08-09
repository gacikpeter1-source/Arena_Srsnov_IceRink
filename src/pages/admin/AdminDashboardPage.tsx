import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { cancelBooking, fetchBookingsInRange, createBooking, SlotUnavailableError } from '@/lib/bookings'
import { exportBookingsToExcel, parseBookingsWorkbook } from '@/lib/excel'
import { addDays, formatDateISO } from '@/lib/utils'
import { Booking } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AdminCreateBookingModal from '@/components/AdminCreateBookingModal'
import EditBookingModal from '@/components/EditBookingModal'
import AdminStaffPanel from '@/components/AdminStaffPanel'

export default function AdminDashboardPage() {
  const { t } = useTranslation()
  const { staff, logout } = useAuth()
  const { club, zones, timeSlotConfig, divisionRules } = useClubData()

  const [dateFrom, setDateFrom] = useState(formatDateISO(new Date()))
  const [dateTo, setDateTo] = useState(formatDateISO(new Date()))
  const [bookings, setBookings] = useState<(Booking & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingBooking, setEditingBooking] = useState<(Booking & { id: string }) | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; failed: string[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const zoneNameById = new Map(zones.map((z) => [z.id, z.name]))

  const refreshBookings = () => {
    if (!club) return
    setLoading(true)
    fetchBookingsInRange(club.id, dateFrom, dateTo)
      .then(setBookings)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refreshBookings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club, dateFrom, dateTo])

  if (staff?.role === 'pending') {
    return (
      <div className="content-container py-12 max-w-md mx-auto text-center space-y-4">
        <h1>{t('admin.pendingTitle')}</h1>
        <p className="text-text-secondary">{t('admin.pendingNotice')}</p>
        <Button variant="outline" onClick={logout}>{t('admin.signOut')}</Button>
      </div>
    )
  }

  const canManageStaff = staff?.role === 'owner' || staff?.role === 'superadmin'

  const handleCancel = async (booking: Booking & { id: string }) => {
    if (!confirm(t('admin.confirmCancel'))) return
    try {
      await cancelBooking(booking.id)
      refreshBookings()
    } catch (err) {
      console.error('Error cancelling booking:', err)
      alert(t('common.error'))
    }
  }

  const handleExport = () => {
    exportBookingsToExcel(bookings, zones, `bookings_${dateFrom}_to_${dateTo}.xlsx`)
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !club || !timeSlotConfig) return

    setImporting(true)
    setImportResult(null)
    try {
      const buffer = await file.arrayBuffer()
      const { rows, errors } = parseBookingsWorkbook(buffer, timeSlotConfig.slotDurationMinutes)
      const zoneByName = new Map(zones.map((z) => [z.name.trim().toLowerCase(), z]))
      const failed: string[] = errors.map((err) => `Row ${err.rowNumber}: ${err.message}`)
      let imported = 0

      for (const row of rows) {
        const zone = zoneByName.get(row.zoneName.trim().toLowerCase())
        if (!zone) {
          failed.push(`${row.date} ${row.startTime}: unknown zone "${row.zoneName}"`)
          continue
        }
        try {
          const created = await createBooking({
            clubId: club.id,
            zoneId: zone.id,
            date: row.date,
            startTime: row.startTime,
            durationMinutes: row.durationMinutes,
            name: row.name,
            email: row.email,
            phone: row.phone
          })
          if (row.status === 'cancelled') {
            await cancelBooking(created.id)
          }
          imported++
        } catch (err) {
          const reason = err instanceof SlotUnavailableError ? t('booking.slotUnavailable') : t('common.error')
          failed.push(`${row.date} ${row.startTime} (${zone.name}): ${reason}`)
        }
      }

      setImportResult({ imported, failed })
      refreshBookings()
    } catch (err) {
      console.error('Import failed:', err)
      setImportResult({ imported: 0, failed: [t('common.error')] })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="content-container py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1>{t('admin.dashboardTitle')}</h1>
          <p className="text-text-secondary">{t('admin.signedInAs', { email: staff?.email })}</p>
        </div>
        <Button variant="outline" onClick={logout}>{t('admin.signOut')}</Button>
      </div>

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white">{t('admin.reservations')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="date-from" className="text-white">{t('admin.from')}</Label>
              <Input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-background-dark border-border text-white"
              />
            </div>
            <div>
              <Label htmlFor="date-to" className="text-white">{t('admin.to')}</Label>
              <Input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-background-dark border-border text-white"
              />
            </div>
            <Button variant="outline" onClick={() => { setDateFrom(formatDateISO(new Date())); setDateTo(formatDateISO(addDays(new Date(), 6))) }}>
              {t('admin.thisWeek')}
            </Button>

            <div className="flex-1" />

            <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary-gold text-primary-foreground">
              {t('admin.newReservation')}
            </Button>
            <Button variant="outline" onClick={handleExport} disabled={bookings.length === 0}>
              {t('admin.exportExcel')}
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? t('admin.importing') : t('admin.importExcel')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleImportFile}
            />
          </div>

          {importResult && (
            <div className="text-sm space-y-1 border border-border rounded-md p-3 bg-background-dark">
              <p className="text-status-success">{t('admin.importedCount', { count: importResult.imported })}</p>
              {importResult.failed.length > 0 && (
                <ul className="text-status-danger list-disc list-inside">
                  {importResult.failed.map((msg, i) => <li key={i}>{msg}</li>)}
                </ul>
              )}
            </div>
          )}

          {loading ? (
            <p className="text-text-muted">{t('common.loading')}</p>
          ) : bookings.length === 0 ? (
            <p className="text-text-muted">{t('admin.noBookingsInRange')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted border-b border-border">
                    <th className="py-2 pr-3">{t('admin.date')}</th>
                    <th className="py-2 pr-3">{t('admin.time')}</th>
                    <th className="py-2 pr-3">{t('admin.zone')}</th>
                    <th className="py-2 pr-3">{t('common.name')}</th>
                    <th className="py-2 pr-3">{t('common.email')}</th>
                    <th className="py-2 pr-3">{t('common.phone')}</th>
                    <th className="py-2 pr-3">{t('admin.status')}</th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id} className="border-b border-border">
                      <td className="py-2 pr-3 mono">{b.date}</td>
                      <td className="py-2 pr-3 mono text-primary">{b.startTime}</td>
                      <td className="py-2 pr-3">{zoneNameById.get(b.zoneId) ?? b.zoneId}</td>
                      <td className="py-2 pr-3 text-white">{b.name}</td>
                      <td className="py-2 pr-3 text-text-secondary">{b.email}</td>
                      <td className="py-2 pr-3 text-text-secondary">{b.phone}</td>
                      <td className={`py-2 pr-3 ${b.status === 'cancelled' ? 'text-status-muted' : 'text-status-success'}`}>
                        {b.status === 'cancelled' ? t('admin.statusCancelled') : t('admin.statusConfirmed')}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setEditingBooking(b)}>
                            {t('common.edit')}
                          </Button>
                          {b.status === 'confirmed' && (
                            <Button size="sm" variant="destructive" onClick={() => handleCancel(b)}>
                              {t('common.cancel')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {canManageStaff && staff && club && (
        <AdminStaffPanel clubId={club.id} viewerUid={staff.uid} viewerRole={staff.role} />
      )}

      {club && timeSlotConfig && (
        <AdminCreateBookingModal
          club={club}
          zones={zones}
          timeSlotConfig={timeSlotConfig}
          divisionRules={divisionRules}
          isOpen={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={refreshBookings}
        />
      )}

      <EditBookingModal
        booking={editingBooking}
        onClose={() => setEditingBooking(null)}
        onSaved={refreshBookings}
      />
    </div>
  )
}
