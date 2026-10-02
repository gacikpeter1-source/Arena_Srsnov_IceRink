import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

// Any team name containing "prenájom" (rental) — "Ľad na prenájom" (whole
// rink), "Tretina na prenájom" (one third), or any future wording staff
// type the same way — is a generic paid-rental slot, not a specific team/
// trainer. Team names are plain free text (no stored value anywhere in the
// data model, see CLAUDE.md's "no club-wide team registry" note), so this
// is a substring match rather than a fixed list of exact labels; accents
// are folded first so "prenájom"/"prenajom" (typed without the diacritic)
// both match, purely for this board's own color-coding.
function isRentalLabel(label: string): boolean {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .includes('prenajom')
}

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

// Groups active (not-yet-finished) items by exact start time — two or three
// events sharing one start time (the ice split into zones) land in the same
// slot/cell rather than one cell each.
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

// The single soonest upcoming slot only turns red once it's this close to
// starting — before that it renders in the same yellow tier as every other
// later slot, per an explicit "vysvietená najskôr 45min pred začiatkom" (lit
// up no earlier than 45 minutes before start) request.
const NEXT_HIGHLIGHT_MINUTES = 45

// "Later" (yellow) cells' font/padding scale dynamically to fit however many
// events a real day actually has — see RinkBoardColumn below for the
// measure-and-shrink mechanism. LATER_FONT_MAX_REM (30px at the default 16px
// root) is a hard ceiling an event is never scaled past even on the
// quietest day; LATER_FONT_FLOOR_REM is just a last-resort safety floor
// (never literally vanish), not a "comfortable minimum" — the whole point of
// the dynamic approach is that there is no fixed minimum, everything shrinks
// as far as it needs to so every scheduled event for the day is visible.
const LATER_FONT_MAX_REM = 1.875 // 30px
const LATER_PAD_Y_MAX_REM = 0.3
const LATER_GAP_MAX_REM = 0.25
const LATER_FONT_FLOOR_REM = 0.4

function renderSlotCell(
  t: (key: string, opts?: Record<string, unknown>) => string,
  slot: BoardSlot,
  variant: 'live' | 'next' | 'later',
  laterMetrics?: { fontRem: number; padYRem: number }
) {
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
          const colorClasses = isRentalLabel(it.label) ? 'text-sky-300' : 'text-white'
          return (
            <div
              key={it.id}
              className={`flex items-center gap-2 min-w-0 font-semibold ${sizeOnlyClasses} ${colorClasses}`}
              style={variant === 'later' && laterMetrics ? { fontSize: `${laterMetrics.fontRem}rem` } : undefined}
            >
              {/* Name / time / room each their own column (no dashes) so
                  every row's time lines up under the next, same for room —
                  `ch`-based widths scale with this row's own font size, so
                  columns stay aligned at whatever size the day's density
                  computed. */}
              <span className="flex-1 min-w-0 truncate">
                {it.label}
                {it.liveScore ? ` (${it.liveScore})` : ''}
              </span>
              <span className="shrink-0 w-[5.5ch] mono text-right overflow-hidden">{minutesToTime(slot.startMin)}</span>
              <span className="shrink-0 w-[10ch] truncate">{room ?? ''}</span>
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

/**
 * One rink's event column on the TV board. Owns a measure-and-shrink pass
 * (via useLayoutEffect, which runs before the browser paints so the
 * adjustment is invisible rather than flashing full-size then shrinking):
 * render the "later" cells at `scale` (starting at 1, i.e. the full
 * LATER_FONT_MAX_REM ceiling), measure the real content height against the
 * column's actual available height, and if it overflows, shrink `scale` by
 * the overflow ratio and let React re-render/re-measure — repeats until it
 * fits or hits LATER_FONT_FLOOR_REM. `scale` resets to 1 whenever `items`
 * itself changes (a new poll, or an event moving from upcoming to live/
 * finished) so the day re-tries at full size and only shrinks again if it
 * still doesn't fit — otherwise a quiet stretch of the day would stay
 * stuck at whatever size an earlier, busier moment had shrunk it to.
 */
function RinkBoardColumn({
  items,
  nowMin,
  t
}: {
  items: BoardItem[]
  nowMin: number
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const [scale, setScale] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const lastItemsRef = useRef(items)

  const slots = groupIntoSlots(items)
  const liveSlots = slots.filter((s) => s.startMin <= nowMin)
  const upcomingSlots = slots.filter((s) => s.startMin > nowMin)
  const hasNext = upcomingSlots.length > 0 && upcomingSlots[0].startMin - nowMin <= NEXT_HIGHLIGHT_MINUTES
  const nextSlot = hasNext ? upcomingSlots[0] : null
  const laterSlots = hasNext ? upcomingSlots.slice(1) : upcomingSlots

  const fontRem = Math.max(LATER_FONT_FLOOR_REM, LATER_FONT_MAX_REM * scale)
  const padYRem = Math.max(0.03, LATER_PAD_Y_MAX_REM * scale)
  const gapRem = Math.max(0.04, LATER_GAP_MAX_REM * scale)

  useLayoutEffect(() => {
    if (lastItemsRef.current !== items) {
      lastItemsRef.current = items
      if (scale !== 1) {
        setScale(1)
        return
      }
    }
    const container = containerRef.current
    const list = listRef.current
    if (!container || !list) return
    const available = container.clientHeight
    const needed = list.scrollHeight
    if (needed > available + 1 && scale > 0.05) {
      const ratio = (available / needed) * 0.96
      setScale((s) => Math.max(0.05, Math.min(1, s * ratio)))
    }
    // Deliberately keyed on [items, scale], not left dependency-less: the
    // parent recomputes `items` as a brand-new array every render (every
    // poll/clock tick), so this still re-measures whenever anything the
    // board cares about changes, without React warning about an unbounded
    // effect that re-runs after every single render for no declared reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, scale])

  if (slots.length === 0) return <p className="text-text-muted text-base">{t('rinkSchedule.boardNoUpcoming')}</p>

  return (
    <div ref={containerRef} className="flex-1 min-h-0 w-full overflow-hidden">
      <div ref={listRef} className="flex flex-col w-full" style={{ gap: `${gapRem}rem` }}>
        {liveSlots.map((slot) => renderSlotCell(t, slot, 'live'))}
        {nextSlot && renderSlotCell(t, nextSlot, 'next')}
        {laterSlots.map((slot) => renderSlotCell(t, slot, 'later', { fontRem, padYRem }))}
      </div>
    </div>
  )
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
            <div key={rink.id} className="flex-1 min-w-0 flex flex-col rounded-2xl border border-border bg-background-card p-2 gap-1">
              <h2 className="shrink-0 text-white text-sm font-bold text-center truncate">{localizedName(rink, i18n.language)}</h2>
              <RinkBoardColumn items={itemsByRink.get(rink.id) ?? []} nowMin={nowMin} t={t} />
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
