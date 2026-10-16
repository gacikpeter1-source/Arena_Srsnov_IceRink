import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  rescheduleRinkScheduleEntry,
  rescheduleRinkScheduleOccurrence,
  renameRinkScheduleEntrySeries,
  rescheduleRinkScheduleEntrySeriesTime,
  RinkScheduleOccurrenceFields
} from '@/lib/rinkSchedule'
import { findSlotConflict, findOverlapConflict, resolveSlotConflict, SlotConflict } from '@/lib/rinkConflicts'
import { SlotUnavailableError } from '@/lib/bookings'
import { localizedName, withRoomPrefix, stripRoomPrefix } from '@/lib/utils'
import { Booking, Rink, RinkScheduleEntry, Zone } from '@/types'
import RoomPrefixInput from './RoomPrefixInput'

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
  // Overwriting someone else's real reservation is restricted to
  // assistant/owner/superadmin — see RinkSchedulePage.tsx's own
  // canReplaceReservations for the role check this mirrors.
  canReplaceReservations: boolean
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
  canReplaceReservations,
  isOpen,
  onClose,
  onSaved
}: RinkScheduleEditModalProps) {
  const { t, i18n } = useTranslation()
  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)

  const [rinkId, setRinkId] = useState(occurrence.rinkId)
  const [zoneId, setZoneId] = useState(occurrence.zoneId)
  const [teamName, setTeamName] = useState(occurrence.name)
  const [room, setRoom] = useState(stripRoomPrefix(t('rinkSchedule.room'), currentRoom ?? ''))
  const [awayRoom, setAwayRoom] = useState(stripRoomPrefix(t('rinkSchedule.awayRoom'), currentAwayRoom ?? ''))
  const [date, setDate] = useState(occurrence.date)
  const [startTime, setStartTime] = useState(occurrence.startTime)
  const [durationMinutes, setDurationMinutes] = useState(occurrence.durationMinutes)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<SlotConflict | null>(null)
  // Only ever offered for a recurring entry (see the checkbox's own JSX) —
  // when checked, the name change is propagated to every live occurrence
  // in the series via renameRinkScheduleEntrySeries, not just this one.
  const [renameWholeSeries, setRenameWholeSeries] = useState(false)
  // Only ever offered when the rink/zone/time-of-day actually changed for
  // THIS occurrence while its own date stayed put (see canShiftSeriesTime
  // below) — when checked, that same rink/zone/startTime/durationMinutes
  // is applied to every other live occurrence too, via
  // rescheduleRinkScheduleEntrySeriesTime.
  const [moveWholeSeriesTime, setMoveWholeSeriesTime] = useState(false)

  const zonesForRink = zones.filter((z) => z.rinkId === rinkId).sort((a, b) => a.slotIndex - b.slotIndex)

  // Mirrors the exact "sameSlot" check rescheduleRinkScheduleEntry/
  // rescheduleRinkScheduleOccurrence (lib/rinkSchedule.ts) make themselves:
  // when the zone/date/time haven't actually changed, apply() patches the
  // existing booking's other fields (name/rinkId/durationMinutes) in place
  // and never calls createBooking at all — so there is no real slot to
  // protect and the overlap-conflict check below must be skipped entirely
  // for this case. Running it anyway was the actual bug behind "editing
  // the team name/room/duration on an unmoved entry says the slot is
  // already taken": findOverlapConflict only excludes THIS occurrence's
  // own booking, not any other real (and already perfectly legitimate)
  // booking that happens to physically overlap the same ice — a state of
  // affairs that already existed before this edit and isn't being created
  // by it, so it must never block a same-slot save.
  const sameSlot = zoneId === occurrence.zoneId && date === occurrence.date && startTime === occurrence.startTime

  // A bulk time shift only makes sense when this occurrence's own DATE
  // stayed the same but its rink/zone/time-of-day moved — moving one
  // occurrence to a different calendar DATE is a one-off thing (e.g. a
  // single rescheduled practice), not "the whole series now runs at a
  // different time", so that case doesn't offer this checkbox at all.
  const canShiftSeriesTime = Boolean(entry.seriesId) && date === occurrence.date && !sameSlot

  useEffect(() => {
    if (!isOpen) return
    setRinkId(occurrence.rinkId)
    setZoneId(occurrence.zoneId)
    setTeamName(occurrence.name)
    setRoom(stripRoomPrefix(t('rinkSchedule.room'), currentRoom ?? ''))
    setAwayRoom(stripRoomPrefix(t('rinkSchedule.awayRoom'), currentAwayRoom ?? ''))
    setDate(occurrence.date)
    setStartTime(occurrence.startTime)
    setDurationMinutes(occurrence.durationMinutes)
    setError(null)
    setRenameWholeSeries(false)
    setMoveWholeSeriesTime(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, occurrence.id])

  useEffect(() => {
    if (!isOpen || !zoneId || !durationMinutes) return
    // A same-slot edit never touches the real reservation at all (see
    // sameSlot's own doc comment above) — showing a conflict banner here
    // would misleadingly suggest the save is about to create a problem
    // that, in fact, already existed and isn't changing.
    if (sameSlot) {
      setConflict(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      // Real interval overlap, not just an exact-slot match — see
      // findOverlapConflict's own doc comment. Excludes this occurrence's
      // own booking so moving it to a new zone/date/time never flags a
      // conflict against the slot it's currently leaving.
      findOverlapConflict(clubId, rinkId, zoneId, zones, date, startTime, durationMinutes, occurrence.id).then((result) => {
        if (!cancelled) setConflict(result)
      })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isOpen, clubId, rinkId, zoneId, zones, date, startTime, durationMinutes, occurrence.id, sameSlot])

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
      room: withRoomPrefix(t('rinkSchedule.room'), room),
      awayRoom: withRoomPrefix(t('rinkSchedule.awayRoom'), awayRoom),
      timezone
    }
    const apply = () =>
      entry.seriesId
        ? rescheduleRinkScheduleOccurrence(entry, occurrence.id, fields)
        : rescheduleRinkScheduleEntry(entry, fields)
    try {
      // Skip the overlap-conflict gate entirely for a same-slot edit —
      // see sameSlot's own doc comment above. apply() will patch the
      // booking's other fields in place and never call createBooking, so
      // there's no real reservation change here for a conflict check to
      // protect; running it anyway was blocking a harmless team-name/
      // room/duration-only edit whenever some other, already-legitimate
      // booking happened to physically overlap the same unmoved slot.
      if (!sameSlot) {
        // Real interval-overlap check before ever calling the reschedule —
        // see findOverlapConflict's doc comment for why an exact-slot match
        // alone isn't enough. Resolves one blocking conflict at a time and
        // re-checks, since more than one zone can block a 'full' move.
        let overlap = await findOverlapConflict(clubId, rinkId, zoneId, zones, date, startTime, durationMinutes, occurrence.id)
        while (overlap) {
          if (overlap.ownerId && canReplaceReservations && confirm(t('rinkSchedule.confirmReplace', { label: overlap.label }))) {
            await resolveSlotConflict(overlap)
            overlap = await findOverlapConflict(clubId, rinkId, zoneId, zones, date, startTime, durationMinutes, occurrence.id)
          } else {
            setError(t('rinkSchedule.slotUnavailable'))
            setSaving(false)
            return
          }
        }
      }
      const applyResult = await apply()
      // See RescheduleResult's own doc comment (lib/rinkSchedule.ts) — a
      // move that actually happened (new booking created) but couldn't
      // release the old slot leaves a stale 'confirmed' booking behind,
      // which the TV board (reading bookings directly) then shows as a
      // phantom duplicate alongside the real, moved entry. Surfacing this
      // immediately beats letting it pile up silently.
      if (applyResult.oldBookingCancelFailed) {
        alert(t('rinkSchedule.oldSlotCancelFailed'))
      }
      // Propagates the new rink/zone/time to every other live occurrence in
      // the series, after apply() above — so it picks up this occurrence's
      // own (just-recreated) booking already at the new slot and simply
      // leaves it alone on its own pass, rather than moving it twice.
      if (canShiftSeriesTime && moveWholeSeriesTime) {
        const shiftResult = await rescheduleRinkScheduleEntrySeriesTime(entry, { rinkId, zoneId, startTime, durationMinutes, timezone })
        if (shiftResult.skippedDates.length > 0) {
          alert(t('rinkSchedule.seriesTimeShiftPartial', { moved: shiftResult.movedCount, dates: shiftResult.skippedDates.join(', ') }))
        }
        if (shiftResult.cancelFailedDates.length > 0) {
          alert(t('rinkSchedule.seriesTimeShiftCancelFailed', { dates: shiftResult.cancelFailedDates.join(', ') }))
        }
      }
      // Propagates just the new name to every other live occurrence in the
      // series, after any time shift above — so it picks up whichever
      // booking id each occurrence currently has (possibly just-recreated
      // by the shift). This occurrence's own name gets written twice (once
      // by apply(), once here), which is harmless — same value either way.
      if (entry.seriesId && renameWholeSeries) {
        await renameRinkScheduleEntrySeries(entry, fields.teamName)
      }
      onSaved()
      onClose()
    } catch (err) {
      if (err instanceof SlotUnavailableError) {
        // Fallback for a race the proactive overlap check above couldn't
        // catch — exact-slot lookup, same as before.
        const found = await findSlotConflict(clubId, zoneId, date, startTime)
        if (found?.ownerId && canReplaceReservations && confirm(t('rinkSchedule.confirmReplace', { label: found.label }))) {
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
            <div className="sm:col-span-2">
              <Label className="text-white">{t('rinkSchedule.teamName')}</Label>
              <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} className="bg-background-dark border-border text-white" required />
              {entry.seriesId && (
                <label className="flex items-center gap-2 mt-2 text-sm text-text-secondary">
                  <input type="checkbox" checked={renameWholeSeries} onChange={(e) => setRenameWholeSeries(e.target.checked)} />
                  {t('rinkSchedule.renameWholeSeries')}
                </label>
              )}
            </div>
            <div>
              <Label className="text-white">{t('common.date')}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-background-dark border-border text-white" required />
            </div>
            <div>
              <Label className="text-white">{t('common.time')}</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="bg-background-dark border-border text-white" required />
            </div>
            {canShiftSeriesTime && (
              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input type="checkbox" checked={moveWholeSeriesTime} onChange={(e) => setMoveWholeSeriesTime(e.target.checked)} />
                  {t('rinkSchedule.moveWholeSeriesTime')}
                </label>
              </div>
            )}
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
              <RoomPrefixInput prefix={t('rinkSchedule.room')} value={room} onChange={setRoom} placeholder={t('rinkSchedule.roomPlaceholder')} />
            </div>
            <div>
              <Label className="text-white">{t('rinkSchedule.awayRoom')}</Label>
              <RoomPrefixInput prefix={t('rinkSchedule.awayRoom')} value={awayRoom} onChange={setAwayRoom} placeholder={t('rinkSchedule.awayRoomPlaceholder')} />
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
