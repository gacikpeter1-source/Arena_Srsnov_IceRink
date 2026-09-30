import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { fetchBookingsInRange } from '@/lib/bookings'
import { fetchRinkScheduleEntries } from '@/lib/rinkSchedule'
import { fetchTournaments, fetchTournamentMatches, deriveMatchState } from '@/lib/tournaments'
import { formatDateISO, timeToMinutes, minutesToTime, localizedName } from '@/lib/utils'
import { Booking, RinkScheduleEntry, TournamentMatch } from '@/types'
import ScaleToFit from '@/components/ScaleToFit'
import BackButton from '@/components/BackButton'

const POLL_MS = 30000
const CLOCK_TICK_MS = 30000

interface BoardItem {
  id: string
  rinkId: string
  zoneLabel: string
  label: string
  room?: string
  awayRoom?: string
  startMin: number
  endMin: number
  state: 'upcoming' | 'live' | 'finished'
  liveScore?: string
}

// Combines a home + away locker room into one display string — e.g. for a
// match where both teams need their own room. Falls back to whichever one
// side actually has, or undefined when neither does.
function formatRoomLine(t: (key: string, opts?: Record<string, unknown>) => string, room?: string, awayRoom?: string): string | undefined {
  if (room && awayRoom) return t('rinkSchedule.roomBothLine', { home: room, away: awayRoom })
  return room ?? awayRoom
}

/**
 * Public "who has the ice when" board — merges the rink team schedule
 * (real Bookings, whether created via RinkSchedulePage.tsx or directly by
 * a customer) with live tournament matches for the same rink/day into one
 * feed, per CLAUDE.md's "Rink team schedule" > "Planned next" discussion.
 * Same "one route, query params pick the case" pattern as /turnaje:
 * `?display=tv` renders the fixed, no-scroll kiosk dashboard (one column
 * per rink); the plain route is a normal scrollable page for a phone
 * visitor. Deliberately shows raw TournamentMatch.teamA/teamB text (no
 * placeholder resolution via withResolvedPlaceholders) — a simpler,
 * "good enough for a glance" pass; /turnaje itself remains the
 * authoritative detailed view for a tournament's own resolved schedule.
 */
export default function RinkScheduleBoardPage() {
  const { t, i18n } = useTranslation()
  const { staff } = useAuth()
  const { club, rinks, zones } = useClubData()
  const [searchParams] = useSearchParams()
  const isTvMode = searchParams.get('display') === 'tv'
  const canManage = staff?.isTrainer || staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'
  const backFallback = canManage ? '/admin/rozvrh' : '/'

  const [bookings, setBookings] = useState<(Booking & { id: string })[]>([])
  const [entries, setEntries] = useState<(RinkScheduleEntry & { id: string })[]>([])
  const [matches, setMatches] = useState<(TournamentMatch & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(new Date())

  const today = formatDateISO(new Date())
  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)

  useEffect(() => {
    if (!club) return
    const refresh = async () => {
      const [b, e, tournaments] = await Promise.all([
        fetchBookingsInRange(club.id, today, today),
        fetchRinkScheduleEntries(club.id),
        fetchTournaments(club.id)
      ])
      const matchLists = await Promise.all(tournaments.map((tr) => fetchTournamentMatches(tr.id)))
      setBookings(b)
      setEntries(e)
      setMatches(matchLists.flat().filter((m) => m.date === today && m.location === 'rink'))
    }
    refresh().finally(() => setLoading(false))
    const interval = setInterval(refresh, POLL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club, today])

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => clearInterval(clock)
  }, [])

  const nowMin = now.getHours() * 60 + now.getMinutes()

  // "30.09.2026 09:45" — a fixed, language-independent format for the TV
  // header clock (this is a physical display, not something a viewer picks
  // a language for), replacing the old "back to standard view" link there
  // — nobody at a wall-mounted screen needs that escape hatch.
  function formatBoardClock(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const zoneName = (zoneId: string) => {
    const zone = zones.find((z) => z.id === zoneId)
    return zone ? localizedName(zone, i18n.language) : ''
  }

  const roomByBookingId = new Map<string, string>()
  const roomBySeriesId = new Map<string, string>()
  const awayRoomByBookingId = new Map<string, string>()
  const awayRoomBySeriesId = new Map<string, string>()
  entries.forEach((entry) => {
    if (entry.room) {
      if (entry.bookingId) roomByBookingId.set(entry.bookingId, entry.room)
      if (entry.seriesId) roomBySeriesId.set(entry.seriesId, entry.room)
    }
    if (entry.awayRoom) {
      if (entry.bookingId) awayRoomByBookingId.set(entry.bookingId, entry.awayRoom)
      if (entry.seriesId) awayRoomBySeriesId.set(entry.seriesId, entry.awayRoom)
    }
    // A rescheduled occurrence of a series can carry its own room override
    // (see RinkScheduleEntry.occurrenceRooms/occurrenceAwayRooms) — checked
    // first below, so it wins over the series' shared room default for
    // that one booking.
    Object.entries(entry.occurrenceRooms ?? {}).forEach(([bookingId, room]) => roomByBookingId.set(bookingId, room))
    Object.entries(entry.occurrenceAwayRooms ?? {}).forEach(([bookingId, room]) => awayRoomByBookingId.set(bookingId, room))
  })

  const bookingItems: BoardItem[] = bookings
    .filter((b) => b.status === 'confirmed')
    .map((b) => {
      const startMin = timeToMinutes(b.startTime)
      const endMin = startMin + b.durationMinutes
      return {
        id: b.id,
        rinkId: b.rinkId,
        zoneLabel: zoneName(b.zoneId),
        label: b.name,
        room: roomByBookingId.get(b.id) ?? (b.seriesId ? roomBySeriesId.get(b.seriesId) : undefined),
        awayRoom: awayRoomByBookingId.get(b.id) ?? (b.seriesId ? awayRoomBySeriesId.get(b.seriesId) : undefined),
        startMin,
        endMin,
        state: endMin <= nowMin ? 'finished' : startMin <= nowMin ? 'live' : 'upcoming'
      } as BoardItem
    })

  const matchItems: BoardItem[] = matches
    .filter((m): m is TournamentMatch & { id: string; rinkId: string; zoneId: string } => !!m.rinkId && !!m.zoneId)
    .map((m) => {
      const startMin = timeToMinutes(m.startTime)
      const endMin = startMin + m.durationMinutes
      const derived = deriveMatchState(m)
      const timeState: BoardItem['state'] = endMin <= nowMin ? 'finished' : startMin <= nowMin ? 'live' : 'upcoming'
      const state: BoardItem['state'] = derived === 'finished' ? 'finished' : derived === 'live' ? 'live' : timeState
      return {
        id: m.id,
        rinkId: m.rinkId,
        zoneLabel: zoneName(m.zoneId),
        label: `${m.teamA} – ${m.teamB}`,
        startMin,
        endMin,
        state,
        liveScore: state !== 'upcoming' && m.scoreA != null && m.scoreB != null ? `${m.scoreA}:${m.scoreB}` : undefined
      }
    })

  const itemsByRink = new Map<string, BoardItem[]>()
  activeRinks.forEach((r) => itemsByRink.set(r.id, []))
  ;[...bookingItems, ...matchItems].forEach((item) => {
    if (!itemsByRink.has(item.rinkId)) itemsByRink.set(item.rinkId, [])
    itemsByRink.get(item.rinkId)!.push(item)
  })
  itemsByRink.forEach((items) => items.sort((a, b) => a.startMin - b.startMin))

  // Replaces the old interactive sliding timeline — staff found it hard to
  // read at a glance. Instead: a plain stacked list of "slots" (one per
  // distinct start time), each its own cell. Two or three events can
  // legitimately share one start time (the ice split into zones) — those
  // land in the same cell, one shared time at the top and each event's own
  // name+room stacked underneath, rather than one cell per event.
  interface BoardSlot {
    startMin: number
    items: BoardItem[]
  }

  function groupIntoSlots(items: BoardItem[]): BoardSlot[] {
    const active = items.filter((it) => it.state !== 'finished')
    const byStart = new Map<number, BoardItem[]>()
    active.forEach((it) => {
      if (!byStart.has(it.startMin)) byStart.set(it.startMin, [])
      byStart.get(it.startMin)!.push(it)
    })
    return Array.from(byStart.entries())
      .sort(([a], [b]) => a - b)
      .map(([startMin, slotItems]) => ({ startMin, items: slotItems }))
  }

  function renderSlotCell(slot: BoardSlot, variant: 'live' | 'next' | 'later') {
    const cellClasses =
      variant === 'live'
        ? 'border-status-success bg-status-success/15'
        : variant === 'next'
          ? 'border-status-danger bg-status-danger/15'
          : 'border-border bg-background-dark'
    const timeClasses =
      variant === 'live'
        ? 'text-status-success text-lg sm:text-xl'
        : variant === 'next'
          ? 'text-status-danger text-3xl sm:text-4xl'
          : 'text-text-secondary text-base sm:text-lg'
    const nameClasses =
      variant === 'next' ? 'text-xl sm:text-2xl text-white' : variant === 'live' ? 'text-base sm:text-lg text-white' : 'text-sm sm:text-base text-text-secondary'
    const roomClasses = variant === 'next' ? 'text-sm sm:text-base text-text-muted' : 'text-xs sm:text-sm text-text-muted'

    return (
      <div key={slot.startMin} className={`rounded-xl border-2 px-4 py-2 ${cellClasses}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className={`font-bold mono ${timeClasses}`}>{minutesToTime(slot.startMin)}</span>
          {variant === 'live' && <span className="text-status-success text-xs uppercase tracking-wide font-semibold">{t('tournaments.liveNow')}</span>}
          {variant === 'next' && <span className="text-status-danger text-xs uppercase tracking-wide font-semibold">{t('rinkSchedule.upNext')}</span>}
        </div>
        <div className="flex flex-col gap-0.5">
          {slot.items.map((it) => (
            <div key={it.id} className="flex items-center justify-between gap-3">
              <span className={`font-semibold truncate ${nameClasses}`}>
                {it.label}
                {it.liveScore ? ` (${it.liveScore})` : ''}
              </span>
              {formatRoomLine(t, it.room, it.awayRoom) && <span className={`whitespace-nowrap ${roomClasses}`}>{formatRoomLine(t, it.room, it.awayRoom)}</span>}
            </div>
          ))}
        </div>
      </div>
    )
  }

  function renderEventList(items: BoardItem[]) {
    const slots = groupIntoSlots(items)
    if (slots.length === 0) return <p className="text-text-muted text-base">{t('rinkSchedule.boardNoUpcoming')}</p>
    const liveSlots = slots.filter((s) => s.startMin <= nowMin)
    const upcomingSlots = slots.filter((s) => s.startMin > nowMin)
    return (
      <div className="flex flex-col gap-3 w-full">
        {liveSlots.map((slot) => renderSlotCell(slot, 'live'))}
        {upcomingSlots.map((slot, i) => renderSlotCell(slot, i === 0 ? 'next' : 'later'))}
      </div>
    )
  }

  if (isTvMode) {
    return (
      <div className="h-full w-full bg-background-dark flex flex-col p-4 gap-3 text-white">
        <div className="shrink-0 flex items-center gap-3 rounded-2xl border border-border bg-background-card px-4" style={{ height: '9vh' }}>
          <Link
            to="/rozvrh"
            replace
            className="shrink-0 mono text-text-secondary text-sm sm:text-lg whitespace-nowrap hover:text-primary"
          >
            {formatBoardClock(now)}
          </Link>
          <h1 className="flex-1 min-w-0 text-[clamp(1.1rem,3.2vw,3rem)] font-bold text-primary text-center truncate">
            {club?.name ?? t('rinkSchedule.title')}
          </h1>
        </div>

        <div className="flex-1 min-h-0 flex gap-3">
          {activeRinks.map((rink) => (
            <div key={rink.id} className="flex-1 min-w-0 flex flex-col rounded-2xl border border-border bg-background-card p-3 gap-2">
              <h2 className="shrink-0 text-white text-lg font-bold text-center truncate">{localizedName(rink, i18n.language)}</h2>
              <div className="flex-1 min-h-0">
                <ScaleToFit className="h-full w-full">{renderEventList(itemsByRink.get(rink.id) ?? [])}</ScaleToFit>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="content-container py-6 space-y-6">
      <BackButton fallback={backFallback} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-white">{t('rinkSchedule.title')}</h1>
        <Link to="/rozvrh?display=tv" className="text-primary hover:text-primary-gold text-sm underline w-fit">
          {t('tournaments.viewAsScreen')}
        </Link>
      </div>

      {loading ? (
        <p className="text-text-muted">{t('common.loading')}</p>
      ) : activeRinks.every((r) => (itemsByRink.get(r.id) ?? []).length === 0) ? (
        <p className="text-text-muted">{t('rinkSchedule.boardNone')}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {activeRinks.map((rink) => {
            const items = itemsByRink.get(rink.id) ?? []
            return (
              <div key={rink.id} className="rounded-lg border border-border bg-background-card p-4 space-y-3">
                <h2 className="text-white text-lg font-bold">{localizedName(rink, i18n.language)}</h2>
                {items.length === 0 ? (
                  <p className="text-text-muted text-sm">{t('rinkSchedule.boardNoneForRink')}</p>
                ) : (
                  <div className="space-y-2">
                    {items.map((it) => (
                      <div key={it.id} className="flex items-center justify-between gap-3 text-sm">
                        <div>
                          <p className={`font-medium ${it.state === 'live' ? 'text-status-danger' : it.state === 'finished' ? 'text-text-muted' : 'text-white'}`}>
                            {it.label}
                            {it.state === 'live' && ` · ${t('tournaments.liveNow')}`}
                            {it.liveScore ? ` (${it.liveScore})` : ''}
                          </p>
                          <p className="text-text-muted text-xs">
                            {it.zoneLabel}
                            {formatRoomLine(t, it.room, it.awayRoom) ? ` · ${formatRoomLine(t, it.room, it.awayRoom)}` : ''}
                          </p>
                        </div>
                        <span className="text-text-secondary whitespace-nowrap">
                          {minutesToTime(it.startMin)}–{minutesToTime(it.endMin)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
