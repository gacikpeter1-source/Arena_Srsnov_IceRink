import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { createFreeIceSlot, deleteFreeIceSlot, fetchFreeIceSlots, updateFreeIceSlot } from '@/lib/freeIceSlots'
import { formatDateISO, localizedName } from '@/lib/utils'
import { FreeIceSlot } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Link } from 'react-router-dom'
import BackButton from '@/components/BackButton'
import QrCodeDisplay from '@/components/QrCodeDisplay'

/**
 * Staff tool for the "free ice available to rent" listing (see FreeIceSlot
 * in src/types/index.ts) — a plain CRUD list, replacing the external
 * spreadsheet the club previously kept this in by hand. Deliberately no
 * conflict-detection/booking integration at all (unlike RinkSchedulePage.tsx)
 * — this is advertising copy for ice that's still open, not a reservation.
 * Shown on the alternating TV board at /rozvrh/strieda.
 */
export default function FreeIceSlotsPage() {
  const { t, i18n } = useTranslation()
  const { user, staff } = useAuth()
  const { club, rinks } = useClubData()
  const canManage = staff?.isTrainer || staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'

  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)

  const [slots, setSlots] = useState<(FreeIceSlot & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [rinkId, setRinkId] = useState('')
  const [date, setDate] = useState(formatDateISO(new Date()))
  const [startTime, setStartTime] = useState('06:00')
  const [endTime, setEndTime] = useState('07:00')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => {
    if (!club) return
    setLoading(true)
    fetchFreeIceSlots(club.id)
      .then(setSlots)
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [club])

  useEffect(() => {
    if (activeRinks.length && !rinkId) setRinkId(activeRinks[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRinks])

  const resetForm = () => {
    setEditingId(null)
    setDate(formatDateISO(new Date()))
    setStartTime('06:00')
    setEndTime('07:00')
    setNote('')
  }

  const handleEdit = (slot: FreeIceSlot & { id: string }) => {
    setEditingId(slot.id)
    setRinkId(slot.rinkId)
    setDate(slot.date)
    setStartTime(slot.startTime)
    setEndTime(slot.endTime)
    setNote(slot.note ?? '')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!club || !user || !staff || !rinkId || !date || !startTime || !endTime) return
    setSaving(true)
    setError(null)
    try {
      const fields = { rinkId, date, startTime, endTime, note: note.trim() || undefined }
      if (editingId) {
        await updateFreeIceSlot(editingId, fields)
      } else {
        await createFreeIceSlot({ ...fields, clubId: club.id, createdBy: user.uid, createdByName: staff.name })
      }
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
      if (editingId === slot.id) resetForm()
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  const rinkNameById = new Map(rinks.map((r) => [r.id, localizedName(r, i18n.language)]))

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
          </div>
        </CardContent>
      </Card>

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{editingId ? t('freeIce.editSlot') : t('freeIce.newSlot')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-4">
            {error && <p className="text-status-danger text-sm sm:col-span-4">{error}</p>}
            <div>
              <Label className="text-white">{t('admin.rink')}</Label>
              <select value={rinkId} onChange={(e) => setRinkId(e.target.value)} className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2">
                {activeRinks.map((r) => (
                  <option key={r.id} value={r.id}>{localizedName(r, i18n.language)}</option>
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
            <div>
              <Label className="text-white">{t('freeIce.endTime')}</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="bg-background-dark border-border text-white" required />
            </div>
            <div className="sm:col-span-4">
              <Label className="text-white">{t('freeIce.note')}</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('freeIce.notePlaceholder')} className="bg-background-dark border-border text-white" />
            </div>
            <div className="sm:col-span-4 flex gap-2">
              <Button type="submit" disabled={saving} className="bg-primary hover:bg-primary-gold text-primary-foreground">
                {saving ? t('common.saving') : editingId ? t('common.save') : t('freeIce.addSlot')}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  {t('common.cancel')}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('freeIce.listTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-text-muted">{t('common.loading')}</p>
          ) : slots.length === 0 ? (
            <p className="text-text-muted text-sm">{t('freeIce.none')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted border-b border-border">
                    <th className="py-2 pr-3">{t('common.date')}</th>
                    <th className="py-2 pr-3">{t('common.time')}</th>
                    <th className="py-2 pr-3">{t('admin.rink')}</th>
                    <th className="py-2 pr-3">{t('freeIce.note')}</th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => (
                    <tr key={slot.id} className="border-b border-border">
                      <td className="py-2 pr-3 mono">{slot.date}</td>
                      <td className="py-2 pr-3 mono text-primary">{slot.startTime}–{slot.endTime}</td>
                      <td className="py-2 pr-3">{rinkNameById.get(slot.rinkId) ?? slot.rinkId}</td>
                      <td className="py-2 pr-3 text-text-secondary">{slot.note ?? '—'}</td>
                      <td className="py-2 pr-3">
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" disabled={busyId === slot.id} onClick={() => handleEdit(slot)}>
                            {t('common.edit')}
                          </Button>
                          <Button size="sm" variant="destructive" disabled={busyId === slot.id} onClick={() => handleDelete(slot)}>
                            {t('common.delete')}
                          </Button>
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
    </div>
  )
}
