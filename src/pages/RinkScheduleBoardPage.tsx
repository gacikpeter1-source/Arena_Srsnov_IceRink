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
import BackButton from '@/components/BackButton'

const POLL_MS = 30000
const CLOCK_TICK_MS = 30000
// The conventional team-name staff type for a generic open-ice rental (no
// specific team/trainer) — free text, not a stored value anywhere in the
// data model (see CLAUDE.md's "no club-wide team registry" note), matched
// by exact string purely for this board's own color-coding.
const ICE_RENTAL_LABEL = 'Ľad na prenájom'

interface BoardItem {
  id: string
  rinkId: string
  zoneLabel: string
  // A short "which physical part of the ice" marker (A/B/C, derived from the
  // zone's own slotIndex) — only set for a genuinely split zone (half/third),
  // never for a whole-rink booking, which has no "which part" ambiguity.
  zonePart?: string
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

  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)

  // `refresh` deliberately recomputes "today" from a fresh `new Date()` on
  // every call, rather than closing over a `today` computed once at the
  // effect's own setup — a long-running kiosk tab's setInterval callbacks
  // all share the same closure, so a `today` value only captured when the
  // effect last ran would stay stuck on the old date forever once midnight
  // passes, unless something else happened to force the whole effect to
  // re-run again exactly then. This was a real bug: a TV left on overnight
  // kept showing the previous day's schedule well past midnight.
  useEffect(() => {
    if (!club) return
    const refresh = async () => {
      const today = formatDateISO(new Date())
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
    // A screen that was asleep/backgrounded (TV standby, a laptop lid, a
    // throttled background tab) can have its timers paused for a while —
    // refresh immediately the moment it's looked at again, rather than
    // waiting up to POLL_MS for the next tick to notice anything changed.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [club])

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => clearInterval(clock)
  }, [])

  const nowMin = now.getHours() * 60 + now.getMinutes()

  // "Piatok 30.09.2026 09:45" — a fixed, language-independent format for the
  // TV header clock (this is a physical display, not something a viewer
  // picks a language for), replacing the old "back to standard view" link
  // there — nobody at a wall-mounted screen needs that escape hatch. The day
  // name is always Slovak, same reasoning as the rest of this fixed format.
  const BOARD_DAY_NAMES = ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota']
  function formatBoardClock(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${BOARD_DAY_NAMES[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const zoneName = (zoneId: string) => {
    const zone = zones.find((z) => z.id === zoneId)
    return zone ? localizedName(zone, i18n.language) : ''
  }
  // "Which part of the ice" letter (A/B/C) for a split zone — see BoardItem's
  // own doc comment. Free text for now, matching an explicit "volný text, ale
  // zatiaľ ako príklad A, B, C" request.
  const zonePart = (zoneId: string): string | undefined => {
    const zone = zones.find((z) => z.id === zoneId)
    if (!zone || zone.mode === 'full') return undefined
    return String.fromCharCode(65 + zone.slotIndex)
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
        zonePart: zonePart(b.zoneId),
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
        zonePart: zonePart(m.zoneId),
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

  // Upcoming slots beyond this are simply not shown — without a JS
  // auto-shrink step (see below), an unbounded list could overflow the
  // column, so this caps at what a typical day comfortably fits. Raised
  // from 5 once the "later" cells were shrunk specifically so a full day
  // (~14 slots, e.g. a real Friday schedule) fits on one 1920x1080 screen
  // without scrolling.
  const MAX_UPCOMING_SLOTS = 20
  // The single soonest upcoming slot only turns red once it's this close to
  // starting — before that it renders in the same yellow tier as every
  // other later slot, per an explicit "vysvietená najskôr 45min pred
  // začiatkom" (lit up no earlier than 45 minutes before start) request.
  const NEXT_HIGHLIGHT_MINUTES = 45

  // "Later" (yellow) cells scale their font/padding based on how many are
  // showing — bigger on a quiet day, smaller on a packed ~14-15 slot one —
  // but deliberately do NOT flex-grow to fill leftover space: a single
  // event stretched across the whole screen height looked wrong on a real
  // TV, so a quiet day now just leaves blank space below instead of
  // inflating one cell to fill it. LATER_FONT_MAX_REM (30px at the default
  // 16px root) is a hard ceiling — the largest size a single headline
  // event is allowed to render at, deliberately never scaled past this no
  // matter how few other events there are. LATER_FONT_MIN_REM is the
  // readability floor for the busiest realistic day.
  const LATER_DENSE_COUNT = 15 // a real full-day schedule (see CLAUDE.md)
  const LATER_SPARSE_COUNT = 3
  const LATER_FONT_MIN_REM = 1.05
  const LATER_FONT_MAX_REM = 1.875 // 30px
  const LATER_PAD_Y_MIN_REM = 0.3
  const LATER_PAD_Y_MAX_REM = 0.6

  function laterCellStyle(laterCount: number) {
    const clamped = Math.min(Math.max(laterCount, LATER_SPARSE_COUNT), LATER_DENSE_COUNT)
    const t = (clamped - LATER_SPARSE_COUNT) / (LATER_DENSE_COUNT - LATER_SPARSE_COUNT)
    const fontRem = LATER_FONT_MAX_REM - t * (LATER_FONT_MAX_REM - LATER_FONT_MIN_REM)
    const padYRem = LATER_PAD_Y_MAX_REM - t * (LATER_PAD_Y_MAX_REM - LATER_PAD_Y_MIN_REM)
    return { fontRem, padYRem }
  }

  function renderSlotCell(slot: BoardSlot, variant: 'live' | 'next' | 'later', laterMetrics?: { fontRem: number; padYRem: number }) {
    const cellClasses =
      variant === 'live'
        ? 'border-status-success bg-status-success/15'
        : variant === 'next'
          ? 'border-status-danger bg-status-danger/15'
          : 'border-status-warning bg-status-warning/15'
    const sizeOnlyClasses =
      variant === 'next' ? 'text-[clamp(0.95rem,1.6vw,1.3rem)]' : variant === 'live' ? 'text-[clamp(0.8rem,1.15vw,1rem)]' : ''
    // Every cell sizes to its own content (shrink-0) — a "later" cell never
    // flex-grows to fill leftover height, so one lone event never balloons
    // into a screen-filling box; its font/padding just scale within the
    // bounded range computed above.
    const sizeClasses = variant === 'later' ? 'shrink-0 px-3' : 'shrink-0 px-3 py-1.5'
    const laterStyle = variant === 'later' && laterMetrics ? { paddingTop: `${laterMetrics.padYRem}rem`, paddingBottom: `${laterMetrics.padYRem}rem` } : undefined

    return (
      <div key={slot.startMin} className={`w-full rounded-lg border ${sizeClasses} ${cellClasses}`} style={laterStyle}>
        {(variant === 'live' || variant === 'next') && (
          <div className="mb-0.5">
            {variant === 'live' && <span className="text-status-success text-[0.65rem] uppercase tracking-wide font-semibold">{t('rinkSchedule.liveNow')}</span>}
            {variant === 'next' && <span className="text-status-danger text-[0.65rem] uppercase tracking-wide font-semibold">{t('rinkSchedule.upNext')}</span>}
          </div>
        )}
        <div className="flex flex-col gap-0.5 w-full">
          {slot.items.map((it) => {
            const room = formatRoomLine(t, it.room, it.awayRoom)
            // A plain ice rental ("Ľad na prenájom" — no team/trainer, just
            // open ice staff put up for anyone to rent) gets a subtly
            // different, cooler text color so it's easy to pick out from
            // real team/trainer bookings at a glance, without touching the
            // cell's own green/red/amber live-status background.
            const colorClasses = it.label === ICE_RENTAL_LABEL ? 'text-sky-300' : 'text-white'
            return (
              <div
                key={it.id}
                className={`flex items-center gap-1.5 min-w-0 font-semibold ${sizeOnlyClasses} ${colorClasses}`}
                style={variant === 'later' && laterMetrics ? { fontSize: `${laterMetrics.fontRem}rem` } : undefined}
              >
                <span className="truncate">
                  {it.label} - {minutesToTime(slot.startMin)}
                  {room ? ` - ${room}` : ''}
                  {it.liveScore ? ` (${it.liveScore})` : ''}
                </span>
                {it.zonePart && (
                  <span className="shrink-0 inline-flex items-center justify-center rounded border border-current px-1.5 leading-tight text-[0.75em] font-bold whitespace-nowrap">
                    {it.zoneLabel}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function renderEventList(items: BoardItem[]) {
    const slots = groupIntoSlots(items)
    if (slots.length === 0) return <p className="text-text-muted text-base">{t('rinkSchedule.boardNoUpcoming')}</p>
    const liveSlots = slots.filter((s) => s.startMin <= nowMin)
    const upcomingSlots = slots.filter((s) => s.startMin > nowMin).slice(0, MAX_UPCOMING_SLOTS)
    const hasNext = upcomingSlots.length > 0 && upcomingSlots[0].startMin - nowMin <= NEXT_HIGHLIGHT_MINUTES
    const laterCount = upcomingSlots.length - (hasNext ? 1 : 0)
    const laterMetrics = laterCellStyle(laterCount)
    return (
      <div className="flex flex-col gap-2 w-full h-full overflow-hidden">
        {liveSlots.map((slot) => renderSlotCell(slot, 'live'))}
        {upcomingSlots.map((slot, i) =>
          renderSlotCell(slot, i === 0 && hasNext ? 'next' : 'later', laterMetrics)
        )}
      </div>
    )
  }

  if (isTvMode) {
    return (
      <div className="h-full w-full bg-background-dark flex flex-col p-3 gap-2 text-white">
        <div className="shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl border border-border bg-background-card px-4" style={{ height: '6vh' }}>
          <Link
            to="/rozvrh"
            replace
            className="justify-self-start mono text-text-secondary text-sm sm:text-lg whitespace-nowrap hover:text-primary"
          >
            {formatBoardClock(now)}
          </Link>
          <h1 className="justify-self-center min-w-0 text-[clamp(1.1rem,3.2vw,3rem)] font-bold text-primary text-center truncate">
            {club?.name ?? t('rinkSchedule.title')}
          </h1>
          <div aria-hidden="true" />
        </div>

        <div className="flex-1 min-h-0 flex gap-3">
          {activeRinks.map((rink) => (
            <div key={rink.id} className="flex-1 min-w-0 flex flex-col rounded-2xl border border-border bg-background-card p-3 gap-2">
              <h2 className="shrink-0 text-white text-lg font-bold text-center truncate">{localizedName(rink, i18n.language)}</h2>
              <div className="flex-1 min-h-0 w-full">{renderEventList(itemsByRink.get(rink.id) ?? [])}</div>
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
                            {it.state === 'live' && ` · ${t('rinkSchedule.liveNow')}`}
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
