import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { cancelFreeIceSlotRepeat, createFreeIceSlot, deleteFreeIceSlot, fetchFreeIceSlots, startFreeIceSlotRepeat } from '@/lib/freeIceSlots'
import { fetchBookingsInRange, isPastAdminVisibilityCutoffByEndTime } from '@/lib/bookings'
import { formatDateISO, localizedName } from '@/lib/utils'
import { Booking, FreeIceSlot } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Link } from 'react-router-dom'
import BackButton from '@/components/BackButton'
import QrCodeDisplay from '@/components/QrCodeDisplay'
import FreeIceImportPanel from '@/components/FreeIceImportPanel'
import FreeIceSlotEditModal from '@/components/FreeIceSlotEditModal'

/**
 * Staff tool for the "free ice available to rent" listing (see FreeIceSlot
 * in src/types/index.ts) — replacing the external spreadsheet the club
 * previously kept this in by hand. This is now the SOLE source of what the
 * public `/book` page offers (see CLAUDE.md's "Free ice import becomes the
 * public booking source" note) — a rink/date with no entries here shows as
 * closed on `/book`, with no fallback to the old generated schedule.
 * Deliberately no conflict-detection of its own (unlike RinkSchedulePage.tsx)
 * — a customer books a slot through the exact same public createBooking
 * transaction every other reservation uses, so double-booking protection is
 * unchanged; this page only decides what gets *offered*.
 */
export default function FreeIceSlotsPage() {
  const { t, i18n } = useTranslation()
  const { user, staff } = useAuth()
  const { club, rinks, zones } = useClubData()
  const canManage = staff?.isTrainer || staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'

  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)

  const [slots, setSlots] = useState<(FreeIceSlot & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [editingSlot, setEditingSlot] = useState<(FreeIceSlot & { id: string }) | null>(null)
  const [rinkId, setRinkId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [date, setDate] = useState(formatDateISO(new Date()))
  const [startTime, setStartTime] = useState('06:00')
  const [endTime, setEndTime] = useState('07:00')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Quick filters over the list below — independent of the create-form's
  // own rinkId/zoneId/date state above, same "picking a filter never
  // changes what the form is about to submit" convention
  // RinkSchedulePage.tsx's own filters already established. Rink/date/zone
  // are all exact matches (unlike that page's free-text time/name filters)
  // since a club owner here is narrowing by a fixed id, not searching.
  const [filterRinkId, setFilterRinkId] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [filterZoneId, setFilterZoneId] = useState('')
  const hasActiveFilter = !!(filterRinkId || filterDate || filterZoneId)

  const zonesForRink = zones.filter((z) => z.rinkId === rinkId).sort((a, b) => a.slotIndex - b.slotIndex)
  // Scoped to the picked filter rink, same as AdminDashboardPage.tsx's own
  // zone filter — excludes legacy Zone docs with no rinkId at all (orphans
  // predating the multiple-rinks feature, see CLAUDE.md), since grouping by
  // rink assumes every zone has one.
  const zonesForFilterRink = zones
    .filter((z) => z.rinkId && (!filterRinkId || z.rinkId === filterRinkId))
    .sort((a, b) => (a.rinkId === b.rinkId ? a.slotIndex - b.slotIndex : a.rinkId.localeCompare(b.rinkId)))
  const alternatingUrl = `${window.location.origin}/rozvrh/strieda`
  const [alternatingUrlCopied, setAlternatingUrlCopied] = useState(false)
  const handleCopyAlternatingUrl = async () => {
    await navigator.clipboard.writeText(alternatingUrl)
    setAlternatingUrlCopied(true)
    setTimeout(() => setAlternatingUrlCopied(false), 2000)
  }

  const refresh = () => {
    if (!club) return
    setLoading(true)
    fetchFreeIceSlots(club.id)
      .then((fetched) =>
        // Same 1-hour-past-end admin visibility cutoff as RinkSchedulePage.tsx
        // — display-only, the underlying doc stays in Firestore (see
        // CLAUDE.md's "Admin visibility cutoff / data retention" section).
        setSlots(fetched.filter((s) => !isPastAdminVisibilityCutoffByEndTime(s.date, s.endTime, club.timezone)))
      )
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [club])

  // Cross-references every listed slot against real bookings so the list
  // can show "Rezervované: {meno}" and so cancelling a repeat knows which
  // future occurrences are already spoken for (see cancelFreeIceSlotRepeat's
  // own doc comment) — fetched once over the whole date range the loaded
  // slots span, not one query per row.
  const [bookingsByKey, setBookingsByKey] = useState<Map<string, Booking & { id: string }>>(new Map())
  useEffect(() => {
    if (!club || slots.length === 0) {
      setBookingsByKey(new Map())
      return
    }
    const dates = slots.map((s) => s.date)
    const startDate = dates.reduce((a, b) => (a < b ? a : b))
    const endDate = dates.reduce((a, b) => (a > b ? a : b))
    fetchBookingsInRange(club.id, startDate, endDate).then((bookings) => {
      const map = new Map<string, Booking & { id: string }>()
      for (const b of bookings) {
        if (b.status !== 'confirmed' && b.status !== 'pending') continue
        map.set(`${b.rinkId}__${b.zoneId}__${b.date}__${b.startTime}`, b)
      }
      setBookingsByKey(map)
    })
  }, [club, slots])
  const bookingFor = (slot: FreeIceSlot) => bookingsByKey.get(`${slot.rinkId}__${slot.zoneId}__${slot.date}__${slot.startTime}`)

  useEffect(() => {
    if (activeRinks.length && !rinkId) setRinkId(activeRinks[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRinks])

  useEffect(() => {
    if (zonesForRink.length && !zonesForRink.some((z) => z.id === zoneId)) setZoneId(zonesForRink[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonesForRink])

  const resetForm = () => {
    setDate(formatDateISO(new Date()))
    setStartTime('06:00')
    setEndTime('07:00')
    setNote('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!club || !user || !staff || !rinkId || !zoneId || !date || !startTime || !endTime) return
    setSaving(true)
    setError(null)
    try {
      await createFreeIceSlot({ rinkId, zoneId, date, startTime, endTime, note: note.trim() || undefined, clubId: club.id, createdBy: user.uid, createdByName: staff.name })
      resetForm()
      refresh()
    } catch {
      setError(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (slot: FreeIceSlot & { id: string }) => {
    if (!confirm(t('freeIce.confirmDelete'))) return
    setBusyId(slot.id)
    try {
      await deleteFreeIceSlot(slot.id)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  const handleStartRepeat = async (slot: FreeIceSlot & { id: string }) => {
    setBusyId(slot.id)
    try {
      await startFreeIceSlotRepeat(slot)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  const handleCancelRepeat = async (slot: FreeIceSlot & { id: string }) => {
    if (!club || !slot.seriesId) return
    if (!confirm(t('freeIce.confirmCancelRepeat'))) return
    setBusyId(slot.id)
    try {
      await cancelFreeIceSlotRepeat(club.id, slot.seriesId, new Set(bookingsByKey.keys()))
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  const rinkNameById = new Map(rinks.map((r) => [r.id, localizedName(r, i18n.language)]))
  const zoneNameById = new Map(zones.map((z) => [z.id, localizedName(z, i18n.language)]))

  const visibleSlots = slots.filter((s) => {
    if (filterRinkId && s.rinkId !== filterRinkId) return false
    if (filterDate && s.date !== filterDate) return false
    if (filterZoneId && s.zoneId !== filterZoneId) return false
    return true
  })

  // "Streda" / "Wednesday" — localized to whichever language the admin UI
  // is currently in (unlike the TV-board day names elsewhere in this app,
  // which stay fixed Slovak since a physical kiosk isn't something a
  // viewer picks a language for — this is a staff screen, so it should
  // follow the same language the rest of the page is already in).
  const dayFormatter = new Intl.DateTimeFormat(i18n.language, { weekday: 'long' })
  const dayName = (isoDate: string) => {
    const d = new Date(`${isoDate}T00:00:00`)
    const name = dayFormatter.format(d)
    return name.charAt(0).toUpperCase() + name.slice(1)
  }
  const formatDMY = (isoDate: string) => {
    const [y, m, d] = isoDate.split('-')
    return `${Number(d)}.${Number(m)}.${y}`
  }

  if (staff && !canManage) {
    return (
      <div className="content-container py-12 max-w-md mx-auto text-center space-y-4">
        <BackButton fallback="/admin" />
        <h1>{t('freeIce.notAuthorizedTitle')}</h1>
        <p className="text-text-secondary">{t('freeIce.notAuthorizedNotice')}</p>
      </div>
    )
  }

  return (
    <div className="content-container py-6 space-y-6">
      <BackButton fallback="/admin/rozvrh" />
      <h1 className="text-2xl font-bold text-white">{t('freeIce.title')}</h1>
      <p className="text-text-secondary text-sm">{t('freeIce.intro')}</p>
      <p className="text-status-warning text-sm rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2">
        {t('freeIce.replacesPublicScheduleWarning')}
      </p>

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('rinkSchedule.alternatingTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-start gap-4">
          <QrCodeDisplay value={`${window.location.origin}/rozvrh/strieda`} filename="rozvrh-strieda.png" label={t('rinkSchedule.alternatingTitle')} />
          <div className="flex flex-col gap-2 max-w-md">
            <p className="text-text-secondary text-sm">{t('rinkSchedule.alternatingHint')}</p>
            <Link to="/rozvrh/strieda" className="text-primary hover:text-primary-gold text-sm underline w-fit">
              {t('rinkSchedule.openAlternatingScreen')}
            </Link>
            <div className="mt-2 rounded-md border border-border bg-background-dark px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
              <p className="mono text-primary text-sm break-all">{alternatingUrl}</p>
              <Button type="button" size="sm" variant="outline" onClick={handleCopyAlternatingUrl}>
                {alternatingUrlCopied ? t('admin.linkCopied') : t('admin.copyLink')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('freeIce.newSlot')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-4">
            {error && <p className="text-status-danger text-sm sm:col-span-4">{error}</p>}
            <div>
              <Label className="text-white">{t('admin.rink')}</Label>
              <select value={rinkId} onChange={(e) => setRinkId(e.target.value)} className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2">
                {activeRinks.map((r) => (
                  <option key={r.id} value={r.id} className="bg-background-dark text-white">{localizedName(r, i18n.language)}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-white">{t('admin.zone')}</Label>
              <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2">
                {zonesForRink.map((z) => (
                  <option key={z.id} value={z.id} className="bg-background-dark text-white">{localizedName(z, i18n.language)}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-white">{t('common.date')}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-background-dark border-border text-white" required />
            </div>
            <div>
              <Label className="text-white">{t('freeIce.startTime')}</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="bg-background-dark border-border text-white" required />
            </div>
            <div className="sm:col-span-4">
              <Label className="text-white">{t('freeIce.endTime')}</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="bg-background-dark border-border text-white max-w-[160px]" required />
            </div>
            <div className="sm:col-span-4">
              <Label className="text-white">{t('freeIce.note')}</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('freeIce.notePlaceholder')} className="bg-background-dark border-border text-white" />
            </div>
            <div className="sm:col-span-4 flex gap-2">
              <Button type="submit" disabled={saving} className="bg-primary hover:bg-primary-gold text-primary-foreground">
                {saving ? t('common.saving') : t('freeIce.addSlot')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {club && (
        <FreeIceImportPanel
          clubId={club.id}
          rinks={activeRinks}
          zones={zones}
          createdBy={user?.uid ?? ''}
          createdByName={staff?.name ?? ''}
          onImported={refresh}
        />
      )}

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('freeIce.listTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!loading && slots.length > 0 && (
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3 mb-4 pb-4 border-b border-border">
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
              <div className="min-w-[170px]">
                <Label className="text-white">{t('common.date')}</Label>
                <Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="bg-background-dark border-border text-white" />
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
                      {filterRinkId ? localizedName(z, i18n.language) : `${rinkNameById.get(z.rinkId) ?? z.rinkId} · ${localizedName(z, i18n.language)}`}
                    </option>
                  ))}
                </select>
              </div>
              {hasActiveFilter && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFilterRinkId('')
                    setFilterDate('')
                    setFilterZoneId('')
                  }}
                >
                  {t('rinkSchedule.clearFilters')}
                </Button>
              )}
            </div>
          )}
          {loading ? (
            <p className="text-text-muted">{t('common.loading')}</p>
          ) : slots.length === 0 ? (
            <p className="text-text-muted text-sm">{t('freeIce.none')}</p>
          ) : visibleSlots.length === 0 ? (
            <p className="text-text-muted text-sm">{t('rinkSchedule.noneFiltered')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted border-b border-border">
                    <th className="py-2 pr-3">{t('freeIce.day')}</th>
                    <th className="py-2 pr-3">{t('common.date')}</th>
                    <th className="py-2 pr-3">{t('common.time')}</th>
                    <th className="py-2 pr-3">{t('admin.rink')}</th>
                    <th className="py-2 pr-3">{t('admin.zone')}</th>
                    <th className="py-2 pr-3">{t('freeIce.note')}</th>
                    <th className="py-2 pr-3">{t('freeIce.status')}</th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {visibleSlots.map((slot) => {
                    const booking = bookingFor(slot)
                    return (
                      <tr key={slot.id} className="border-b border-border">
                        <td className="py-2 pr-3">{dayName(slot.date)}</td>
                        <td className="py-2 pr-3 mono">{formatDMY(slot.date)}</td>
                        <td className="py-2 pr-3 mono text-primary">{slot.startTime}–{slot.endTime}</td>
                        <td className="py-2 pr-3">{rinkNameById.get(slot.rinkId) ?? slot.rinkId}</td>
                        <td className="py-2 pr-3">{zoneNameById.get(slot.zoneId) ?? slot.zoneId}</td>
                        <td className="py-2 pr-3 text-text-secondary">{slot.note ?? '—'}</td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-col gap-1">
                            {slot.repeatWeekly && <span className="text-primary text-xs whitespace-nowrap">{t('freeIce.repeatBadge')}</span>}
                            {booking && <span className="text-status-success text-xs whitespace-nowrap">{t('freeIce.bookedBadge', { name: booking.name })}</span>}
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" disabled={busyId === slot.id} onClick={() => setEditingSlot(slot)}>
                              {t('common.edit')}
                            </Button>
                            {slot.repeatWeekly ? (
                              <Button size="sm" variant="outline" disabled={busyId === slot.id} onClick={() => handleCancelRepeat(slot)}>
                                {t('freeIce.cancelRepeat')}
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" disabled={busyId === slot.id || slot.date < formatDateISO(new Date())} onClick={() => handleStartRepeat(slot)}>
                                {t('freeIce.repeat')}
                              </Button>
                            )}
                            <Button size="sm" variant="destructive" disabled={busyId === slot.id} onClick={() => handleDelete(slot)}>
                              {t('common.delete')}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      {editingSlot && (
        <FreeIceSlotEditModal
          rinks={rinks}
          zones={zones}
          slot={editingSlot}
          isOpen={!!editingSlot}
          onClose={() => setEditingSlot(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}
