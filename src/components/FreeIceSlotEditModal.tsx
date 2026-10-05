import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { updateFreeIceSlot } from '@/lib/freeIceSlots'
import { localizedName } from '@/lib/utils'
import { FreeIceSlot, Rink, Zone } from '@/types'

interface FreeIceSlotEditModalProps {
  rinks: Rink[]
  zones: Zone[]
  slot: FreeIceSlot & { id: string }
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
}

/**
 * Edits a FreeIceSlot in a real dialog rather than an inline form — see
 * CLAUDE.md's "FreeIceSlotsPage.tsx" fix note: the previous inline-form
 * approach silently updated a form sitting near the top of the page while
 * the "Upraviť" button triggering it was a per-row action further down,
 * so nothing visibly changed on click. A modal makes the edit impossible
 * to miss regardless of scroll position, matching the same pattern
 * RinkScheduleEditModal.tsx already uses for the sibling rink-schedule
 * domain. Deliberately no conflict-detection here (unlike that modal) —
 * see FreeIceSlotsPage.tsx's own doc comment for why this page never had
 * any to begin with.
 */
export default function FreeIceSlotEditModal({ rinks, zones, slot, isOpen, onClose, onSaved }: FreeIceSlotEditModalProps) {
  const { t, i18n } = useTranslation()
  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)

  const [rinkId, setRinkId] = useState(slot.rinkId)
  const [zoneId, setZoneId] = useState(slot.zoneId)
  const [date, setDate] = useState(slot.date)
  const [startTime, setStartTime] = useState(slot.startTime)
  const [endTime, setEndTime] = useState(slot.endTime)
  const [note, setNote] = useState(slot.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const zonesForRink = zones.filter((z) => z.rinkId === rinkId).sort((a, b) => a.slotIndex - b.slotIndex)

  useEffect(() => {
    if (!isOpen) return
    setRinkId(slot.rinkId)
    setZoneId(slot.zoneId)
    setDate(slot.date)
    setStartTime(slot.startTime)
    setEndTime(slot.endTime)
    setNote(slot.note ?? '')
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, slot.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rinkId || !zoneId || !date || !startTime || !endTime) return
    setSaving(true)
    setError(null)
    try {
      await updateFreeIceSlot(slot.id, { rinkId, zoneId, date, startTime, endTime, note: note.trim() || undefined })
      onSaved()
      onClose()
    } catch {
      setError(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-background-card max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white text-xl">{t('freeIce.editSlot')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <p className="text-status-danger text-sm">{error}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-white">{t('admin.rink')}</Label>
              <select
                value={rinkId}
                onChange={(e) => {
                  const nextRinkId = e.target.value
                  setRinkId(nextRinkId)
                  const firstZone = zones.filter((z) => z.rinkId === nextRinkId).sort((a, b) => a.slotIndex - b.slotIndex)[0]
                  if (firstZone) setZoneId(firstZone.id)
                }}
                className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2"
              >
                {activeRinks.map((r) => (
                  <option key={r.id} value={r.id}>{localizedName(r, i18n.language)}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-white">{t('admin.zone')}</Label>
              <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2">
                {zonesForRink.map((z) => (
                  <option key={z.id} value={z.id}>{localizedName(z, i18n.language)}</option>
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
            <div className="sm:col-span-2">
              <Label className="text-white">{t('freeIce.note')}</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('freeIce.notePlaceholder')} className="bg-background-dark border-border text-white" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving} className="bg-primary hover:bg-primary-gold text-primary-foreground">
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
