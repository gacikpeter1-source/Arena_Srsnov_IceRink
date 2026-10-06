import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import {
  createRinkScheduleEntry,
  deleteRinkScheduleEntry,
  fetchRinkScheduleEntries,
  fetchRinkScheduleOccurrences,
  startRinkScheduleEntryRepeat
} from '@/lib/rinkSchedule'
import { findSlotConflict, findOverlapConflict, resolveSlotConflict, SlotConflict } from '@/lib/rinkConflicts'
import { SlotUnavailableError, SeriesRecurrence, SERIES_MAX_OCCURRENCES, cancelBooking, isPastAdminVisibilityCutoff } from '@/lib/bookings'
import { formatDateISO, addDays, localizedName } from '@/lib/utils'
import { Link } from 'react-router-dom'
import { Booking, RinkScheduleEntry, SeriesFrequency } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import BackButton from '@/components/BackButton'
import RinkScheduleImportPanel from '@/components/RinkScheduleImportPanel'
import RinkScheduleEditModal from '@/components/RinkScheduleEditModal'
import QrCodeDisplay from '@/components/QrCodeDisplay'

/**
 * Staff/trainer "who has the ice when" schedule — see CLAUDE.md's "Rink
 * team schedule" section. Every entry blocks real ice (createBooking/
 * createBookingSeries under the hood via lib/rinkSchedule.ts), so this
 * page is deliberately just a manual create form + Excel import + a flat
 * list, not a second source of availability truth — the atomic booking
 * transaction is what actually prevents a double-booking, this page just
 * surfaces its result.
 */
export default function RinkSchedulePage() {
  const { t, i18n } = useTranslation()
  const { user, staff } = useAuth()
  const { club, rinks, zones } = useClubData()
  const canManage = staff?.isTrainer || staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'
  // Overwriting someone else's real reservation is a bigger action than
  // just planning a schedule entry — restricted to ice-rink staff
  // (assistant/owner/superadmin), not a plain trainer account, even
  // though a trainer can otherwise fully use this page. Mirrors the same
  // gate on TournamentDetailPage.tsx's own conflict-replace flow.
  const canReplaceReservations = staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'

  const [entries, setEntries] = useState<(RinkScheduleEntry & { id: string })[]>([])
  const [occurrencesByEntry, setOccurrencesByEntry] = useState<Map<string, (Booking & { id: string })[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ entry: RinkScheduleEntry & { id: string }; occurrence: Booking & { id: string } } | null>(null)

  // Quick filters over the entries table below — independent of the
  // create-form's own rinkId/date/startTime state above, so picking a
  // filter never affects what the "add new entry" form is about to submit.
  const [filterRinkId, setFilterRinkId] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [filterTime, setFilterTime] = useState('')
  const [filterName, setFilterName] = useState('')
  const hasActiveFilter = !!(filterRinkId || filterDate || filterTime || filterName)

  const [rinkId, setRinkId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [teamName, setTeamName] = useState('')
  const [room, setRoom] = useState('')
  const [awayRoom, setAwayRoom] = useState('')
  const [date, setDate] = useState(formatDateISO(new Date()))
  const [startTime, setStartTime] = useState('17:00')
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [repeat, setRepeat] = useState(false)
  const [frequency, setFrequency] = useState<SeriesFrequency>('weekly')
  const [recurrenceType, setRecurrenceType] = useState<'count' | 'until'>('count')
  const [count, setCount] = useState(8)
  const [untilDate, setUntilDate] = useState(() => formatDateISO(addDays(new Date(), 56)))
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<SlotConflict | null>(null)

  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)
  const zonesForRink = zones.filter((z) => z.rinkId === rinkId).sort((a, b) => a.slotIndex - b.slotIndex)
  const teamNames = useMemo(() => Array.from(new Set(entries.map((e) => e.teamName))).sort(), [entries])
  const rinkNameById = new Map(rinks.map((r) => [r.id, localizedName(r, i18n.language)]))
  const zoneNameById = new Map(zones.map((z) => [z.id, localizedName(z, i18n.language)]))

  // Matches a single occurrence (or, for an entry with no real occurrences
  // left, the entry's own original date/time/rink/name) against whichever
  // filters are currently set — rink is an exact id match, date an exact
  // match, time/name a case-insensitive substring match (so "17" finds
  // every 17:xx start, and typing part of a team name is enough).
  const matchesFilters = (row: { date: string; startTime: string; rinkId: string; name: string }) => {
    if (filterRinkId && row.rinkId !== filterRinkId) return false
    if (filterDate && row.date !== filterDate) return false
    if (filterTime && !row.startTime.includes(filterTime.trim())) return false
    if (filterName && !row.name.toLowerCase().includes(filterName.trim().toLowerCase())) return false
    return true
  }

  const refresh = () => {
    if (!club) return
    setLoading(true)
    fetchRinkScheduleEntries(club.id)
      .then(async (fetchedEntries) => {
        setEntries(fetchedEntries)
        const pairs = await Promise.all(
          fetchedEntries.map(async (e) => [e.id, await fetchRinkScheduleOccurrences(e)] as const)
        )
        setOccurrencesByEntry(new Map(pairs))
      })
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [club])

  useEffect(() => {
    if (activeRinks.length && !rinkId) setRinkId(activeRinks[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRinks])

  useEffect(() => {
    if (zonesForRink.length && !zonesForRink.some((z) => z.id === zoneId)) setZoneId(zonesForRink[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonesForRink])

  // Proactive heads-up before submitting: lets staff see, while still
  // picking rink/zone/date/time/duration, whether a tournament match (or
  // another schedule entry) already occupies overlapping ice — a real
  // time-interval check (findOverlapConflict), not just an exact-slot
  // match, since sessions here don't all start on a clean grid (see
  // CLAUDE.md's "Tournament ↔ rink schedule conflicts" section). Debounced
  // since it fires on every keystroke in the time/duration fields.
  useEffect(() => {
    if (!club || !rinkId || !zoneId || !date || !startTime || !durationMinutes) {
      setConflict(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      findOverlapConflict(club.id, rinkId, zoneId, zones, date, startTime, durationMinutes).then((result) => {
        if (!cancelled) setConflict(result)
      })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [club, rinkId, zoneId, zones, date, startTime, durationMinutes])

  const handleFrequencyChange = (next: SeriesFrequency) => {
    setFrequency(next)
    setCount((c) => Math.min(c, SERIES_MAX_OCCURRENCES[next]))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!club || !user || !staff || !rinkId || !zoneId || !teamName.trim()) return
    setCreating(true)
    setError(null)
    const recurrence: SeriesRecurrence | undefined = repeat
      ? recurrenceType === 'count'
        ? { type: 'count', frequency, count }
        : { type: 'until', frequency, endDate: untilDate }
      : undefined
    const entryInput = {
      clubId: club.id,
      rinkId,
      zoneId,
      teamName: teamName.trim(),
      room: room.trim() || undefined,
      awayRoom: awayRoom.trim() || undefined,
      createdBy: user.uid,
      createdByName: staff.name,
      createdByEmail: staff.email,
      date,
      startTime,
      durationMinutes,
      timezone: club.timezone,
      recurrence
    }
    try {
      if (!recurrence) {
        // Real interval-overlap check before ever calling createBooking —
        // its own transaction only locks the exact zoneId+startTime being
        // requested, so it would happily create a 'full' booking even
        // while a half/third zone on the same rink already covers that
        // time. A rink can have more than one thing blocking a requested
        // slot (e.g. both halves already taken), so this resolves one
        // conflict at a time and re-checks until the slot is genuinely
        // free or the user declines a replace.
        let overlap = await findOverlapConflict(club.id, rinkId, zoneId, zones, date, startTime, durationMinutes)
        while (overlap) {
          if (overlap.ownerId && canReplaceReservations && confirm(t('rinkSchedule.confirmReplace', { label: overlap.label }))) {
            await resolveSlotConflict(overlap)
            overlap = await findOverlapConflict(club.id, rinkId, zoneId, zones, date, startTime, durationMinutes)
          } else {
            setError(t('rinkSchedule.slotUnavailable'))
            setCreating(false)
            return
          }
        }
      }
      await createRinkScheduleEntry(entryInput)
      setTeamName('')
      setRoom('')
      setAwayRoom('')
      refresh()
    } catch (err) {
      if (err instanceof SlotUnavailableError && !recurrence) {
        // Fallback for a race the proactive overlap check above couldn't
        // catch (someone else booked the exact same slot in between) —
        // exact-slot lookup, same as before.
        const found = await findSlotConflict(club.id, zoneId, date, startTime)
        if (found?.ownerId && canReplaceReservations && confirm(t('rinkSchedule.confirmReplace', { label: found.label }))) {
          try {
            await resolveSlotConflict(found)
            await createRinkScheduleEntry(entryInput)
            setTeamName('')
            setRoom('')
            setAwayRoom('')
            refresh()
          } catch {
            setError(t('common.error'))
          }
        } else {
          setError(t('rinkSchedule.slotUnavailable'))
        }
      } else {
        setError(err instanceof SlotUnavailableError ? t('rinkSchedule.slotUnavailable') : t('common.error'))
      }
    } finally {
      setCreating(false)
    }
  }

  // d.m.yyyy, built directly from the stored ISO string's own parts — no
  // UTC/local ambiguity for a pure string reformat, same technique
  // FreeIceSlotsPage.tsx's own formatDMY already uses.
  const formatDMY = (isoDate: string) => {
    const [y, m, d] = isoDate.split('-')
    return `${Number(d)}.${Number(m)}.${y}`
  }

  const handleStartRepeat = async (entry: RinkScheduleEntry & { id: string }) => {
    if (!club) return
    setBusyId(entry.id)
    try {
      await startRinkScheduleEntryRepeat(entry, club.timezone)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (entry: RinkScheduleEntry & { id: string }) => {
    if (!confirm(t('rinkSchedule.confirmDelete'))) return
    setBusyId(entry.id)
    try {
      await deleteRinkScheduleEntry(entry)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  // Cancels just this one occurrence of a recurring entry, leaving the
  // entry doc and every other occurrence untouched — distinct from
  // handleDelete, which removes the whole series. Staff are exempt from
  // the customer self-cancel cutoff, same as deleteRinkScheduleEntry.
  const handleCancelOccurrence = async (occurrence: Booking & { id: string }) => {
    if (!confirm(t('rinkSchedule.confirmCancelOccurrence'))) return
    setBusyId(occurrence.id)
    try {
      await cancelBooking(occurrence.id)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  // An event already over for more than ADMIN_VISIBILITY_CUTOFF_HOURS stops
  // showing on this page entirely — the underlying Booking is untouched (it
  // stays in Firestore for the monthly report / the much-longer hard-delete
  // cutoff, see CLAUDE.md), this is a display-only cutoff for this one list.
  const timezone = club?.timezone ?? 'Europe/Bratislava'
  const isStillVisible = (date: string, startTime: string, durationMinutes: number) =>
    !isPastAdminVisibilityCutoff(date, startTime, durationMinutes, timezone)

  // Pre-filters each entry's occurrences once per render — an entry with
  // zero real occurrences left (after both the age cutoff above and the
  // quick filters below) is matched against its own original date/time/
  // rink/name instead (nothing else to check it against, and only if that
  // original slot itself isn't already aged out — otherwise there'd be
  // nothing left worth showing a placeholder row for), and an entry is only
  // shown at all once at least one of its rows survives, so a series with
  // every occurrence filtered out doesn't leave a stray "delete series" row
  // with nothing above it.
  const visibleEntries = entries
    .map((entry) => {
      const liveOccurrences = (occurrencesByEntry.get(entry.id) ?? []).filter((occ) =>
        isStillVisible(occ.date, occ.startTime, occ.durationMinutes)
      )
      if (liveOccurrences.length === 0) {
        if (!isStillVisible(entry.date, entry.startTime, entry.durationMinutes)) return null
        const matches = matchesFilters({ date: entry.date, startTime: entry.startTime, rinkId: entry.rinkId, name: entry.teamName })
        return matches ? { entry, occurrences: liveOccurrences } : null
      }
      const filteredOccurrences = liveOccurrences.filter((occ) =>
        matchesFilters({ date: occ.date, startTime: occ.startTime, rinkId: occ.rinkId, name: occ.name })
      )
      return filteredOccurrences.length > 0 ? { entry, occurrences: filteredOccurrences } : null
    })
    .filter((v): v is { entry: RinkScheduleEntry & { id: string }; occurrences: (Booking & { id: string })[] } => v !== null)

  // Flattened into one chronologically-sorted list across every entry,
  // not grouped by entry — grouping (the previous behavior) meant a single
  // recurring series spanning months rendered as one contiguous block
  // wherever its first occurrence fell, visually "jumping ahead" of a
  // chronologically-earlier one-off booking that happened to belong to a
  // different entry. `occurrence: null` represents the rare "entry has no
  // live occurrences left" placeholder row (see visibleEntries above),
  // sorted by the entry's own original date/time since that's all it has.
  interface ScheduleRow {
    key: string
    entry: RinkScheduleEntry & { id: string }
    occurrence: (Booking & { id: string }) | null
    sortDate: string
    sortTime: string
  }
  const scheduleRows: ScheduleRow[] = visibleEntries
    .flatMap(({ entry, occurrences }): ScheduleRow[] =>
      occurrences.length === 0
        ? [{ key: entry.id, entry, occurrence: null, sortDate: entry.date, sortTime: entry.startTime }]
        : occurrences.map((occurrence) => ({
            key: occurrence.id,
            entry,
            occurrence,
            sortDate: occurrence.date,
            sortTime: occurrence.startTime
          }))
    )
    .sort((a, b) => (a.sortDate === b.sortDate ? a.sortTime.localeCompare(b.sortTime) : a.sortDate.localeCompare(b.sortDate)))

  if (staff && !canManage) {
    return (
      <div className="content-container py-12 max-w-md mx-auto text-center space-y-4">
        <BackButton fallback="/admin" />
        <h1>{t('rinkSchedule.notAuthorizedTitle')}</h1>
        <p className="text-text-secondary">{t('rinkSchedule.notAuthorizedNotice')}</p>
      </div>
    )
  }

  return (
    <div className="content-container py-6 space-y-6">
      <BackButton fallback="/admin" />
      <h1 className="text-2xl font-bold text-white">{t('rinkSchedule.title')}</h1>
      <p className="text-text-secondary text-sm">{t('rinkSchedule.intro')}</p>

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('rinkSchedule.tvScreenTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-start gap-4">
          <QrCodeDisplay value={`${window.location.origin}/rozvrh?display=tv`} filename="rozvrh-tv.png" label={t('rinkSchedule.title')} />
          <div className="flex flex-col gap-2 max-w-md">
            <p className="text-text-secondary text-sm">{t('rinkSchedule.tvScreenHint')}</p>
            <Link to="/rozvrh?display=tv" className="text-primary hover:text-primary-gold text-sm underline w-fit">
              {t('tournaments.openTvScreen')}
            </Link>
            <div className="mt-2 rounded-md border border-border bg-background-dark px-3 py-2">
              <p className="text-text-muted text-xs">{t('rinkSchedule.tvShortcutHint')}</p>
              <p className="mono text-primary text-xl font-bold">{window.location.origin}/tv</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('rinkSchedule.newEntry')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-4">
            {error && <p className="text-status-danger text-sm sm:col-span-4">{error}</p>}
            {!error && conflict && (
              <p className="text-status-warning text-sm sm:col-span-4">
                {conflict.ownerId
                  ? t('rinkSchedule.conflictNotice', { label: conflict.label })
                  : t('rinkSchedule.conflictNoticeBooking')}
              </p>
            )}
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
            <div className="sm:col-span-2">
              <Label className="text-white">{t('rinkSchedule.teamName')}</Label>
              <Input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                list="rink-schedule-team-names"
                className="bg-background-dark border-border text-white"
                required
              />
              <datalist id="rink-schedule-team-names">
                {teamNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
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
              <Input type="number" min={1} value={durationMinutes} onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10) || 60)} className="bg-background-dark border-border text-white" required />
            </div>
            <div>
              <Label className="text-white">{t('rinkSchedule.room')}</Label>
              <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder={t('rinkSchedule.roomPlaceholder')} className="bg-background-dark border-border text-white" />
            </div>
            <div>
              <Label className="text-white">{t('rinkSchedule.awayRoom')}</Label>
              <Input value={awayRoom} onChange={(e) => setAwayRoom(e.target.value)} placeholder={t('rinkSchedule.awayRoomPlaceholder')} className="bg-background-dark border-border text-white" />
            </div>

            <div className="sm:col-span-4 border-t border-border pt-3">
              <label className="flex items-center gap-2 text-white text-sm cursor-pointer">
                <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="h-4 w-4" />
                {t('booking.repeatBooking')}
              </label>

              {repeat && (
                <div className="mt-3 space-y-3 pl-6">
                  <div className="flex gap-4 text-sm text-white">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="rs-frequency" checked={frequency === 'daily'} onChange={() => handleFrequencyChange('daily')} />
                      {t('booking.frequencyDaily')}
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="rs-frequency" checked={frequency === 'weekly'} onChange={() => handleFrequencyChange('weekly')} />
                      {t('booking.frequencyWeekly')}
                    </label>
                  </div>
                  <div className="flex gap-4 text-sm text-white">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="rs-recurrenceType" checked={recurrenceType === 'count'} onChange={() => setRecurrenceType('count')} />
                      {t('booking.recurrenceForCount')}
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="rs-recurrenceType" checked={recurrenceType === 'until'} onChange={() => setRecurrenceType('until')} />
                      {t('booking.recurrenceUntilDate')}
                    </label>
                  </div>
                  {recurrenceType === 'count' ? (
                    <div>
                      <Label className="text-white">{t('booking.numberOfOccurrences')}</Label>
                      <Input
                        type="number"
                        min={2}
                        max={SERIES_MAX_OCCURRENCES[frequency]}
                        value={count}
                        onChange={(e) => setCount(Number(e.target.value))}
                        className="bg-background-dark border-border text-white max-w-[120px]"
                      />
                    </div>
                  ) : (
                    <div>
                      <Label className="text-white">{t('booking.repeatUntil')}</Label>
                      <Input
                        type="date"
                        min={date}
                        max={formatDateISO(addDays(new Date(`${date}T00:00:00`), (SERIES_MAX_OCCURRENCES[frequency] - 1) * (frequency === 'daily' ? 1 : 7)))}
                        value={untilDate}
                        onChange={(e) => setUntilDate(e.target.value)}
                        className="bg-background-dark border-border text-white"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="sm:col-span-4">
              <Button type="submit" disabled={creating} className="bg-primary hover:bg-primary-gold text-primary-foreground">
                {creating ? t('common.saving') : t('rinkSchedule.createEntry')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {club && (
        <RinkScheduleImportPanel
          clubId={club.id}
          rinks={activeRinks}
          zones={zones}
          createdBy={user?.uid ?? ''}
          createdByName={staff?.name ?? ''}
          createdByEmail={staff?.email ?? ''}
          timezone={club.timezone}
          onImported={refresh}
        />
      )}

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('rinkSchedule.entries')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!loading && entries.length > 0 && (
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3 mb-4 pb-4 border-b border-border">
              <div className="min-w-[160px]">
                <Label className="text-white">{t('admin.rink')}</Label>
                <select
                  value={filterRinkId}
                  onChange={(e) => setFilterRinkId(e.target.value)}
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
              <div className="w-[110px] shrink-0">
                <Label className="text-white">{t('rinkSchedule.filterTime')}</Label>
                <Input
                  value={filterTime}
                  onChange={(e) => setFilterTime(e.target.value)}
                  placeholder={t('rinkSchedule.filterTimePlaceholder')}
                  className="bg-background-dark border-border text-white"
                />
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
                    setFilterDate('')
                    setFilterTime('')
                    setFilterName('')
                  }}
                >
                  {t('rinkSchedule.clearFilters')}
                </Button>
              )}
            </div>
          )}
          {loading ? (
            <p className="text-text-muted">{t('common.loading')}</p>
          ) : entries.length === 0 ? (
            <p className="text-text-muted text-sm">{t('rinkSchedule.none')}</p>
          ) : visibleEntries.length === 0 ? (
            <p className="text-text-muted text-sm">{t('rinkSchedule.noneFiltered')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted border-b border-border">
                    <th className="py-2 pr-3">{t('common.date')}</th>
                    <th className="py-2 pr-3">{t('common.time')}</th>
                    <th className="py-2 pr-3">{t('admin.rink')}</th>
                    <th className="py-2 pr-3">{t('admin.zone')}</th>
                    <th className="py-2 pr-3">{t('rinkSchedule.teamName')}</th>
                    <th className="py-2 pr-3">{t('rinkSchedule.room')}</th>
                    <th className="py-2 pr-3">{t('rinkSchedule.awayRoom')}</th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {scheduleRows.map(({ key, entry, occurrence }) => {
                    const isSeries = !!entry.seriesId
                    if (!occurrence) {
                      return (
                        <tr key={key} className="border-b border-border">
                          <td className="py-2 pr-3 mono text-text-muted" colSpan={4}>{t('rinkSchedule.noOccurrences')}</td>
                          <td className="py-2 pr-3 text-white">{entry.teamName}</td>
                          <td className="py-2 pr-3 text-text-secondary">{entry.room ?? '—'}</td>
                          <td className="py-2 pr-3 text-text-secondary">{entry.awayRoom ?? '—'}</td>
                          <td className="py-2 pr-3">
                            <Button size="sm" variant="destructive" disabled={busyId === entry.id} onClick={() => handleDelete(entry)}>
                              {t('common.delete')}
                            </Button>
                          </td>
                        </tr>
                      )
                    }
                    const room = entry.occurrenceRooms?.[occurrence.id] ?? entry.room
                    const awayRoomValue = entry.occurrenceAwayRooms?.[occurrence.id] ?? entry.awayRoom
                    return (
                      <tr key={key} className="border-b border-border">
                        <td className="py-2 pr-3 mono">{formatDMY(occurrence.date)}{isSeries ? ` (${t('rinkSchedule.recurring')})` : ''}</td>
                        <td className="py-2 pr-3 mono text-primary">{occurrence.startTime}</td>
                        <td className="py-2 pr-3">{rinkNameById.get(occurrence.rinkId) ?? occurrence.rinkId}</td>
                        <td className="py-2 pr-3">{zoneNameById.get(occurrence.zoneId) ?? occurrence.zoneId}</td>
                        <td className="py-2 pr-3 text-white">{occurrence.name}</td>
                        <td className="py-2 pr-3 text-text-secondary">{room ?? '—'}</td>
                        <td className="py-2 pr-3 text-text-secondary">{awayRoomValue ?? '—'}</td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === occurrence.id}
                              onClick={() => setEditing({ entry, occurrence })}
                            >
                              {t('common.edit')}
                            </Button>
                            {!isSeries && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyId === entry.id}
                                onClick={() => handleStartRepeat(entry)}
                              >
                                {t('rinkSchedule.repeat')}
                              </Button>
                            )}
                            {isSeries ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={busyId === occurrence.id}
                                  onClick={() => handleCancelOccurrence(occurrence)}
                                >
                                  {t('rinkSchedule.cancelOccurrence')}
                                </Button>
                                <Button size="sm" variant="destructive" disabled={busyId === entry.id} onClick={() => handleDelete(entry)}>
                                  {t('rinkSchedule.deleteSeries')}
                                </Button>
                              </>
                            ) : (
                              <Button size="sm" variant="destructive" disabled={busyId === entry.id} onClick={() => handleDelete(entry)}>
                                {t('common.delete')}
                              </Button>
                            )}
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

      {editing && club && (
        <RinkScheduleEditModal
          clubId={club.id}
          timezone={club.timezone}
          rinks={activeRinks}
          zones={zones}
          entry={editing.entry}
          occurrence={editing.occurrence}
          currentRoom={editing.entry.occurrenceRooms?.[editing.occurrence.id] ?? editing.entry.room}
          currentAwayRoom={editing.entry.occurrenceAwayRooms?.[editing.occurrence.id] ?? editing.entry.awayRoom}
          canReplaceReservations={canReplaceReservations}
          isOpen={!!editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}
