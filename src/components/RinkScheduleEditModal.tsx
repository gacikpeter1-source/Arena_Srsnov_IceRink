import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  rescheduleRinkScheduleEntry,
  rescheduleRinkScheduleOccurrence,
  RinkScheduleOccurrenceFields
} from '@/lib/rinkSchedule'
import { findSlotConflict, findOverlapConflict, resolveSlotConflict, SlotConflict } from '@/lib/rinkConflicts'
import { SlotUnavailableError } from '@/lib/bookings'
import { localizedName } from '@/lib/utils'
import { Booking, Rink, RinkScheduleEntry, Zone } from '@/types'

interface RinkScheduleEditModalProps {
  clubId: string
  timezone: string
  rinks: Rink[]
  zones: Zone[]
  entry: RinkScheduleEntry & { id: string }
  // The specific occurrence being edited — the entry's own single booking
  // for a non-recurring entry, or one booking out of the series for a
  // recurring one. Either way, this is what the form's date/time/rink/
  // zone/team fields are seeded from.
  occurrence: Booking & { id: string }
  currentRoom?: string
  currentAwayRoom?: string
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
}

/**
 * Edits (or moves) a single scheduled occurrence — see CLAUDE.md's "Rink
 * team schedule" section. Reuses the exact same conflict-detection/
 * replace flow (lib/rinkConflicts.ts) the create form already uses, since
 * moving an occurrence to a new zone/date/time can just as easily collide
 * with a tournament match or another entry as creating one from scratch
 * can.
 */
export default function RinkScheduleEditModal({
  clubId,
  timezone,
  rinks,
  zones,
  entry,
  occurrence,
  currentRoom,
  currentAwayRoom,
  isOpen,
  onClose,
  onSaved
}: RinkScheduleEditModalProps) {
  const { t, i18n } = useTranslation()
  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)

  const [rinkId, setRinkId] = useState(occurrence.rinkId)
  const [zoneId, setZoneId] = useState(occurrence.zoneId)
  const [teamName, setTeamName] = useState(occurrence.name)
  const [room, setRoom] = useState(currentRoom ?? '')
  const [awayRoom, setAwayRoom] = useState(currentAwayRoom ?? '')
  const [date, setDate] = useState(occurrence.date)
  const [startTime, setStartTime] = useState(occurrence.startTime)
  const [durationMinutes, setDurationMinutes] = useState(occurrence.durationMinutes)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<SlotConflict | null>(null)

  const zonesForRink = zones.filter((z) => z.rinkId === rinkId).sort((a, b) => a.slotIndex - b.slotIndex)

  useEffect(() => {
    if (!isOpen) return
    setRinkId(occurrence.rinkId)
    setZoneId(occurrence.zoneId)
    setTeamName(occurrence.name)
    setRoom(currentRoom ?? '')
    setAwayRoom(currentAwayRoom ?? '')
    setDate(occurrence.date)
    setStartTime(occurrence.startTime)
    setDurationMinutes(occurrence.durationMinutes)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, occurrence.id])

  useEffect(() => {
    if (!isOpen || !zoneId || !durationMinutes) return
    let cancelled = false
    const timer = setTimeout(() => {
      // Real interval overlap, not just an exact-slot match — see
      // findOverlapConflict's own doc comment. Excludes this occurrence's
      // own booking so editing it in place (e.g. only the duration
      // changed) never flags a conflict with itself.
      findOverlapConflict(clubId, rinkId, zoneId, zones, date, startTime, durationMinutes, occurrence.id).then((result) => {
        if (!cancelled) setConflict(result)
      })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isOpen, clubId, rinkId, zoneId, zones, date, startTime, durationMinutes, occurrence.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!zoneId || !teamName.trim()) return
    setSaving(true)
    setError(null)
    const fields: RinkScheduleOccurrenceFields = {
      rinkId,
      zoneId,
      date,
      startTime,
      durationMinutes,
      teamName: teamName.trim(),
      room: room.trim() || undefined,
      awayRoom: awayRoom.trim() || undefined,
      timezone
    }
    const apply = () =>
      entry.seriesId
        ? rescheduleRinkScheduleOccurrence(entry, occurrence.id, fields)
        : rescheduleRinkScheduleEntry(entry, fields)
    try {
      // Real interval-overlap check before ever calling the reschedule —
      // see findOverlapConflict's doc comment for why an exact-slot match
      // alone isn't enough. Resolves one blocking conflict at a time and
      // re-checks, since more than one zone can block a 'full' move.
      let overlap = await findOverlapConflict(clubId, rinkId, zoneId, zones, date, startTime, durationMinutes, occurrence.id)
      while (overlap) {
        if (overlap.ownerId && confirm(t('rinkSchedule.confirmReplace', { label: overlap.label }))) {
          await resolveSlotConflict(overlap)
          overlap = await findOverlapConflict(clubId, rinkId, zoneId, zones, date, startTime, durationMinutes, occurrence.id)
        } else {
          setError(t('rinkSchedule.slotUnavailable'))
          setSaving(false)
          return
        }
      }
      await apply()
      onSaved()
      onClose()
    } catch (err) {
      if (err instanceof SlotUnavailableError) {
        // Fallback for a race the proactive overlap check above couldn't
        // catch — exact-slot lookup, same as before.
        const found = await findSlotConflict(clubId, zoneId, date, startTime)
        if (found?.ownerId && confirm(t('rinkSchedule.confirmReplace', { label: found.label }))) {
          try {
            await resolveSlotConflict(found)
            await apply()
            onSaved()
            onClose()
          } catch {
            setError(t('common.error'))
          }
        } else {
          setError(t('rinkSchedule.slotUnavailable'))
        }
      } else {
        setError(t('common.error'))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-background-card max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white text-xl">{t('rinkSchedule.editEntry')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <p className="text-status-danger text-sm">{error}</p>}
          {!error && conflict && (
            <p className="text-status-warning text-sm">
              {conflict.ownerId
                ? t('rinkSchedule.conflictNotice', { label: conflict.label })
                : t('rinkSchedule.conflictNoticeBooking')}
            </p>
          )}
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
            <div className="sm:col-span-2">
              <Label className="text-white">{t('rinkSchedule.teamName')}</Label>
              <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} className="bg-background-dark border-border text-white" required />
            </div>
            <div>
              <Label className="text-white">{t('common.date')}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-background-dark border-border text-white" required />
            </div>
            <div>
              <Label className="text-white">{t('common.time')}</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="bg-background-dark border-border text-white" required />
            </div>
            <div>
              <Label className="text-white">{t('trainerDashboard.durationMin')}</Label>
              <Input
                type="number"
                min={1}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10) || 60)}
                className="bg-background-dark border-border text-white"
                required
              />
            </div>
            <div>
              <Label className="text-white">{t('rinkSchedule.room')}</Label>
              <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder={t('rinkSchedule.roomPlaceholder')} className="bg-background-dark border-border text-white" />
            </div>
            <div>
              <Label className="text-white">{t('rinkSchedule.awayRoom')}</Label>
              <Input value={awayRoom} onChange={(e) => setAwayRoom(e.target.value)} placeholder={t('rinkSchedule.awayRoomPlaceholder')} className="bg-background-dark border-border text-white" />
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
