import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { cancelBooking, fetchBookingsInRange, createBooking, SlotUnavailableError } from '@/lib/bookings'
import { downloadImportTemplate, exportBookingsToExcel, parseBookingsWorkbook } from '@/lib/excel'
import { addDays, formatDateISO, localizedName } from '@/lib/utils'
import { Booking } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AdminCreateBookingModal from '@/components/AdminCreateBookingModal'
import EditBookingModal from '@/components/EditBookingModal'
import AdminStaffPanel from '@/components/AdminStaffPanel'
import AdminQrPanel from '@/components/AdminQrPanel'
import AdminClubSettingsPanel from '@/components/AdminClubSettingsPanel'
import AdminScheduleSettingsPanel from '@/components/AdminScheduleSettingsPanel'
import AdminDaySchedulePanel from '@/components/AdminDaySchedulePanel'
import BackButton from '@/components/BackButton'

export default function AdminDashboardPage() {
  const { t, i18n } = useTranslation()
  const { user, staff, logout } = useAuth()
  const { club, rinks, zones, timeSlotConfigs } = useClubData()

  const [dateFrom, setDateFrom] = useState(formatDateISO(new Date()))
  const [dateTo, setDateTo] = useState(formatDateISO(new Date()))
  const [bookings, setBookings] = useState<(Booking & { id: string })[]>([])
  // Manual-export filter criteria, on top of the date range above — rink/
  // zone exact match, name a case-insensitive substring — applied to both
  // the on-screen table and the Excel export, so "Export" always exports
  // exactly what's currently shown. Same pattern RinkSchedulePage.tsx's own
  // quick filters already use.
  const [filterRinkId, setFilterRinkId] = useState('')
  const [filterZoneId, setFilterZoneId] = useState('')
  const [filterName, setFilterName] = useState('')
  const hasActiveFilter = !!(filterRinkId || filterZoneId || filterName)
  const [loading, setLoading] = useState(true)
  const [bookingsError, setBookingsError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingBooking, setEditingBooking] = useState<(Booking & { id: string }) | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; failed: string[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const zoneNameById = new Map(zones.map((z) => [z.id, localizedName(z, i18n.language)]))
  const rinkNameById = new Map(rinks.map((r) => [r.id, localizedName(r, i18n.language)]))
  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)
  // Excludes legacy zone docs with no rinkId at all (pre-dating the
  // multiple-rinks feature, left in place as harmless orphans — see
  // CLAUDE.md's "Multiple rinks" section) — they can't usefully be shown
  // grouped by rink, and no real Booking references them any more anyway.
  const zonesForFilterRink = zones
    .filter((z) => z.rinkId && (!filterRinkId || z.rinkId === filterRinkId))
    .sort((a, b) => (a.rinkId === b.rinkId ? a.slotIndex - b.slotIndex : a.rinkId.localeCompare(b.rinkId)))

  const filteredBookings = bookings.filter((b) => {
    if (filterRinkId && b.rinkId !== filterRinkId) return false
    if (filterZoneId && b.zoneId !== filterZoneId) return false
    if (filterName && !b.name.toLowerCase().includes(filterName.trim().toLowerCase())) return false
    return true
  })

  // Guards against an older in-flight fetchBookingsInRange response landing
  // AFTER a newer one (e.g. staff changes the date range right after this
  // page loads, or clicks "Táto týždeň" twice quickly) — without this, the
  // slower/older response could overwrite the newer, correct `bookings`
  // state, which would silently narrow or wrong-date what the manual
  // export below actually writes out.
  const latestRequestRef = useRef<string | null>(null)

  const refreshBookings = () => {
    if (!club) return
    const requestKey = `${club.id}|${dateFrom}|${dateTo}`
    latestRequestRef.current = requestKey
    setLoading(true)
    setBookingsError(null)
    fetchBookingsInRange(club.id, dateFrom, dateTo)
      .then((result) => {
        if (latestRequestRef.current !== requestKey) return
        setBookings(result)
      })
      .catch((err) => {
        if (latestRequestRef.current !== requestKey) return
        console.error('Error fetching bookings:', err)
        setBookingsError(t('common.error'))
      })
      .finally(() => {
        if (latestRequestRef.current === requestKey) setLoading(false)
      })
  }

  useEffect(() => {
    refreshBookings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club, dateFrom, dateTo])

  // 'pending' with no trainer access at all — a plain signup still
  // awaiting an owner/superadmin to grant a role.
  if (staff?.role === 'pending' && !staff.isTrainer) {
    return (
      <div className="content-container py-12 max-w-md mx-auto text-center space-y-4">
        <h1>{t('admin.pendingTitle')}</h1>
        <p className="text-text-secondary">{t('admin.pendingNotice')}</p>
        <Button variant="outline" onClick={logout}>{t('admin.signOut')}</Button>
      </div>
    )
  }

  // isTrainer is independent of role (see StaffUser) — an account can be
  // both isStaffMember() and a trainer at once, in which case the normal
  // ice-rink dashboard below is exactly right for them (with a link to
  // their own training dashboard, added below). This redirect only
  // applies to a trainer-only account (role still 'pending', so no
  // ice-rink access at all) — nothing on this page applies to them.
  if (staff?.isTrainer && staff.role === 'pending') {
    return <Navigate to="/admin/treningy" replace />
  }

  const canManageStaff = staff?.role === 'owner' || staff?.role === 'superadmin'
  // Same access model as TournamentsPage.tsx's own guard — any of these
  // roles can quickly plan a tournament.
  const canManageTournaments =
    staff?.isTrainer || staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'

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
    exportBookingsToExcel(filteredBookings, rinks, zones, `bookings_${dateFrom}_to_${dateTo}.xlsx`)
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !club) return

    setImporting(true)
    setImportResult(null)
    try {
      const buffer = await file.arrayBuffer()
      const { rows, errors } = parseBookingsWorkbook(buffer)
      // Zone names (e.g. "Full Rink") are only unique within a rink, so
      // lookups are keyed by rink name + zone name together.
      const rinkByName = new Map(rinks.map((r) => [r.name.trim().toLowerCase(), r]))
      const zoneByKey = new Map(zones.map((z) => [`${z.rinkId}::${z.name.trim().toLowerCase()}`, z]))
      const failed: string[] = errors.map((err) => `Row ${err.rowNumber}: ${err.message}`)
      let imported = 0

      for (const row of rows) {
        const rink = rinkByName.get(row.rinkName.trim().toLowerCase())
        if (!rink) {
          failed.push(`${row.date} ${row.startTime}: unknown rink "${row.rinkName}"`)
          continue
        }
        const zone = zoneByKey.get(`${rink.id}::${row.zoneName.trim().toLowerCase()}`)
        if (!zone) {
          failed.push(`${row.date} ${row.startTime}: unknown zone "${row.zoneName}" on rink "${row.rinkName}"`)
          continue
        }
        try {
          const created = await createBooking({
            clubId: club.id,
            rinkId: rink.id,
            zoneId: zone.id,
            date: row.date,
            startTime: row.startTime,
            durationMinutes: row.durationMinutes,
            name: row.name,
            email: row.email,
            phone: row.phone,
            timezone: club.timezone
          })
          if (row.status === 'cancelled') {
            await cancelBooking(created.id)
          }
          imported++
        } catch (err) {
          const reason = err instanceof SlotUnavailableError ? t('booking.slotUnavailable') : t('common.error')
          failed.push(`${row.date} ${row.startTime} (${localizedName(rink, i18n.language)} · ${localizedName(zone, i18n.language)}): ${reason}`)
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
      <BackButton fallback="/" />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1>{t('admin.dashboardTitle')}</h1>
          <p className="text-text-secondary">{t('admin.signedInAs', { email: staff?.email })}</p>
        </div>
        <div className="flex gap-2">
          {(staff?.isTrainer || canManageStaff) && (
            <Link to="/admin/treningy">
              <Button variant="outline">{t('admin.myTrainings')}</Button>
            </Link>
          )}
          {canManageTournaments && (
            <Link to="/admin/turnaje">
              <Button variant="outline">{t('nav.manageTournaments')}</Button>
            </Link>
          )}
          <Button variant="outline" onClick={logout}>{t('admin.signOut')}</Button>
        </div>
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
            <Button variant="outline" onClick={handleExport} disabled={filteredBookings.length === 0}>
              {t('admin.exportExcel')}
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? t('admin.importing') : t('admin.importExcel')}
            </Button>
            <Button variant="outline" onClick={() => downloadImportTemplate()}>
              {t('admin.downloadTemplate')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleImportFile}
            />
          </div>

          {/* Manual-export filter criteria (on top of the date range above):
              rink/zone exact match, name a substring — narrows both the
              table below and what "Export" actually writes out. */}
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3 pb-4 border-b border-border">
            <div className="min-w-[160px]">
              <Label className="text-white">{t('admin.rink')}</Label>
              <select
                value={filterRinkId}
                onChange={(e) => {
                  setFilterRinkId(e.target.value)
                  setFilterZoneId('')
                }}
                className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2"
              >
                <option value="" className="bg-background-dark text-white">{t('booking.allRinks')}</option>
                {activeRinks.map((r) => (
                  <option key={r.id} value={r.id} className="bg-background-dark text-white">{localizedName(r, i18n.language)}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[160px]">
              <Label className="text-white">{t('admin.zone')}</Label>
              <select
                value={filterZoneId}
                onChange={(e) => setFilterZoneId(e.target.value)}
                className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2"
              >
                <option value="" className="bg-background-dark text-white">{t('admin.allZones')}</option>
                {zonesForFilterRink.map((z) => (
                  <option key={z.id} value={z.id} className="bg-background-dark text-white">
                    {rinkNameById.get(z.rinkId) ?? z.rinkId} · {localizedName(z, i18n.language)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[180px]">
              <Label className="text-white">{t('rinkSchedule.filterName')}</Label>
              <Input
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
                placeholder={t('rinkSchedule.filterNamePlaceholder')}
                className="bg-background-dark border-border text-white"
              />
            </div>
            {hasActiveFilter && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setFilterRinkId('')
                  setFilterZoneId('')
                  setFilterName('')
                }}
              >
                {t('rinkSchedule.clearFilters')}
              </Button>
            )}
          </div>

          <p className="text-text-muted text-xs">{t('admin.importHint')}</p>

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
          ) : bookingsError ? (
            <p className="text-status-danger">{bookingsError}</p>
          ) : bookings.length === 0 ? (
            <p className="text-text-muted">{t('admin.noBookingsInRange')}</p>
          ) : filteredBookings.length === 0 ? (
            <p className="text-text-muted">{t('rinkSchedule.noneFiltered')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted border-b border-border">
                    <th className="py-2 pr-3">{t('admin.date')}</th>
                    <th className="py-2 pr-3">{t('admin.time')}</th>
                    <th className="py-2 pr-3">{t('admin.rink')}</th>
                    <th className="py-2 pr-3">{t('admin.zone')}</th>
                    <th className="py-2 pr-3">{t('common.name')}</th>
                    <th className="py-2 pr-3">{t('common.email')}</th>
                    <th className="py-2 pr-3">{t('common.phone')}</th>
                    <th className="py-2 pr-3">{t('admin.status')}</th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {filteredBookings.map((b) => (
                    <tr key={b.id} className="border-b border-border">
                      <td className="py-2 pr-3 mono">{b.date}</td>
                      <td className="py-2 pr-3 mono text-primary">{b.startTime}</td>
                      <td className="py-2 pr-3">{rinkNameById.get(b.rinkId) ?? b.rinkId}</td>
                      <td className="py-2 pr-3">{zoneNameById.get(b.zoneId) ?? b.zoneId}</td>
                      <td className="py-2 pr-3 text-white">
                        {b.name}
                        {(b.attendeeCount ?? 1) > 1 && (
                          <span className="ml-1 text-text-muted text-xs">×{b.attendeeCount}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-text-secondary">{b.email}</td>
                      <td className="py-2 pr-3 text-text-secondary">{b.phone}</td>
                      <td className={`py-2 pr-3 ${b.status === 'confirmed' ? 'text-status-success' : 'text-status-muted'}`}>
                        {b.status === 'cancelled' && t('admin.statusCancelled')}
                        {b.status === 'confirmed' && t('admin.statusConfirmed')}
                        {b.status === 'pending' && t('admin.statusPending')}
                        {b.status === 'expired' && t('admin.statusExpired')}
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

      {club && <AdminQrPanel club={club} rinks={rinks} zones={zones} timeSlotConfigs={timeSlotConfigs} />}

      <AdminScheduleSettingsPanel rinks={rinks} timeSlotConfigs={timeSlotConfigs} />

      {club && <AdminDaySchedulePanel club={club} rinks={rinks} zones={zones} timeSlotConfigs={timeSlotConfigs} />}

      {canManageStaff && club && <AdminClubSettingsPanel club={club} />}

      {canManageStaff && user && staff && club && (
        <AdminStaffPanel clubId={club.id} viewerUid={user.uid} viewerRole={staff.role} />
      )}

      {club && rinks.length > 0 && (
        <AdminCreateBookingModal
          club={club}
          rinks={rinks}
          zones={zones}
          timeSlotConfigs={timeSlotConfigs}
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
