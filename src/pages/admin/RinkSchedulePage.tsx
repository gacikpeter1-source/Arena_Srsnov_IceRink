import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import {
  createRinkScheduleEntry,
  deleteRinkScheduleEntry,
  fetchRinkScheduleEntries
} from '@/lib/rinkSchedule'
import { SlotUnavailableError, SeriesRecurrence, SERIES_MAX_OCCURRENCES } from '@/lib/bookings'
import { formatDateISO, addDays } from '@/lib/utils'
import { RinkScheduleEntry, SeriesFrequency } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import BackButton from '@/components/BackButton'
import RinkScheduleImportPanel from '@/components/RinkScheduleImportPanel'

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
  const { t } = useTranslation()
  const { user, staff } = useAuth()
  const { club, rinks, zones } = useClubData()
  const canManage = staff?.isTrainer || staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'

  const [entries, setEntries] = useState<(RinkScheduleEntry & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [rinkId, setRinkId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [teamName, setTeamName] = useState('')
  const [room, setRoom] = useState('')
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

  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)
  const zonesForRink = zones.filter((z) => z.rinkId === rinkId).sort((a, b) => a.slotIndex - b.slotIndex)
  const teamNames = useMemo(() => Array.from(new Set(entries.map((e) => e.teamName))).sort(), [entries])
  const rinkNameById = new Map(rinks.map((r) => [r.id, r.name]))
  const zoneNameById = new Map(zones.map((z) => [z.id, z.name]))

  const refresh = () => {
    if (!club) return
    setLoading(true)
    fetchRinkScheduleEntries(club.id)
      .then(setEntries)
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

  const handleFrequencyChange = (next: SeriesFrequency) => {
    setFrequency(next)
    setCount((c) => Math.min(c, SERIES_MAX_OCCURRENCES[next]))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!club || !user || !staff || !rinkId || !zoneId || !teamName.trim()) return
    setCreating(true)
    setError(null)
    try {
      const recurrence: SeriesRecurrence | undefined = repeat
        ? recurrenceType === 'count'
          ? { type: 'count', frequency, count }
          : { type: 'until', frequency, endDate: untilDate }
        : undefined
      await createRinkScheduleEntry({
        clubId: club.id,
        rinkId,
        zoneId,
        teamName: teamName.trim(),
        room: room.trim() || undefined,
        createdBy: user.uid,
        createdByName: staff.name,
        createdByEmail: staff.email,
        date,
        startTime,
        durationMinutes,
        timezone: club.timezone,
        recurrence
      })
      setTeamName('')
      setRoom('')
      refresh()
    } catch (err) {
      setError(err instanceof SlotUnavailableError ? t('rinkSchedule.slotUnavailable') : t('common.error'))
    } finally {
      setCreating(false)
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
          <CardTitle className="text-white text-lg">{t('rinkSchedule.newEntry')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-4">
            {error && <p className="text-status-danger text-sm sm:col-span-4">{error}</p>}
            <div>
              <Label className="text-white">{t('admin.rink')}</Label>
              <select value={rinkId} onChange={(e) => setRinkId(e.target.value)} className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2">
                {activeRinks.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-white">{t('admin.zone')}</Label>
              <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2">
                {zonesForRink.map((z) => (
                  <option key={z.id} value={z.id}>{z.name}</option>
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
          {loading ? (
            <p className="text-text-muted">{t('common.loading')}</p>
          ) : entries.length === 0 ? (
            <p className="text-text-muted text-sm">{t('rinkSchedule.none')}</p>
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
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-border">
                      <td className="py-2 pr-3 mono">{entry.date}{entry.seriesId ? ` (${t('rinkSchedule.recurring')})` : ''}</td>
                      <td className="py-2 pr-3 mono text-primary">{entry.startTime}</td>
                      <td className="py-2 pr-3">{rinkNameById.get(entry.rinkId) ?? entry.rinkId}</td>
                      <td className="py-2 pr-3">{zoneNameById.get(entry.zoneId) ?? entry.zoneId}</td>
                      <td className="py-2 pr-3 text-white">{entry.teamName}</td>
                      <td className="py-2 pr-3 text-text-secondary">{entry.room ?? '—'}</td>
                      <td className="py-2 pr-3">
                        <Button size="sm" variant="destructive" disabled={busyId === entry.id} onClick={() => handleDelete(entry)}>
                          {t('common.delete')}
                        </Button>
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
