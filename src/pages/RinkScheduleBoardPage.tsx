import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { fetchBookingsInRange } from '@/lib/bookings'
import { fetchRinkScheduleEntries } from '@/lib/rinkSchedule'
import { fetchTournaments, fetchTournamentMatches, deriveMatchState } from '@/lib/tournaments'
import { generateQrDataUrl } from '@/lib/qrcode'
import { formatDateISO, timeToMinutes, minutesToTime, localizedName } from '@/lib/utils'
import { Booking, RinkScheduleEntry, TournamentMatch } from '@/types'
import ScaleToFit from '@/components/ScaleToFit'
import BackButton from '@/components/BackButton'

const POLL_MS = 30000
const CLOCK_TICK_MS = 30000
// A fixed 3-hour window centered near "now" (per the club's own design
// concept — see CLAUDE.md's "Rink team schedule" section), recomputed
// every POLL_MS rather than animated frame-by-frame (an explicit "simpler
// is fine" answer) — CSS `transition` on each block's left/width is what
// makes that periodic recompute read as a smooth slide instead of a jump-cut.
const WINDOW_BEFORE_MIN = 30
const WINDOW_AFTER_MIN = 150

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
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

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

  // TV mode's QR always points at the plain (non-`display=tv`) page — same
  // reasoning as the tournament TV dashboard's own corner QR.
  useEffect(() => {
    if (!isTvMode) {
      setQrDataUrl(null)
      return
    }
    let cancelled = false
    generateQrDataUrl(`${window.location.origin}/rozvrh`).then((url) => {
      if (!cancelled) setQrDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [isTvMode])

  const nowMin = now.getHours() * 60 + now.getMinutes()
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

  const windowStart = nowMin - WINDOW_BEFORE_MIN
  const windowEnd = nowMin + WINDOW_AFTER_MIN
  const windowSpan = windowEnd - windowStart

  function renderTimeline(items: BoardItem[]) {
    const visible = items.filter((it) => it.endMin > windowStart && it.startMin < windowEnd)
    const firstHour = Math.floor(windowStart / 60)
    const lastHour = Math.ceil(windowEnd / 60)
    const hourMarks: { h: number; pct: number }[] = []
    for (let h = firstHour; h <= lastHour; h++) {
      const pct = ((h * 60 - windowStart) / windowSpan) * 100
      if (pct >= 0 && pct <= 100) hourMarks.push({ h: ((h % 24) + 24) % 24, pct })
    }
    // Two items can legitimately overlap in time (different zones of the
    // same rink, e.g. a "half" split) — greedily assign each to the first
    // lane whose previous occupant has already ended, so overlapping
    // blocks stack into separate rows instead of rendering on top of each
    // other illegibly.
    const sorted = [...visible].sort((a, b) => a.startMin - b.startMin)
    const laneEnds: number[] = []
    const withLanes = sorted.map((it) => {
      let lane = laneEnds.findIndex((end) => end <= it.startMin)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(it.endMin)
      } else {
        laneEnds[lane] = it.endMin
      }
      return { ...it, lane }
    })
    const laneCount = laneEnds.length || 1
    const laneHeightPct = 78 / laneCount

    return (
      <div className="relative flex-1 min-h-0 rounded-xl border border-border bg-background-dark overflow-hidden">
        {hourMarks.map(({ h, pct }) => (
          <div key={`${h}-${pct}`} className="absolute top-0 bottom-0 border-l border-border/40 text-text-muted text-[0.6rem] sm:text-xs pl-1" style={{ left: `${pct}%` }}>
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-status-danger z-10"
          style={{ left: `${((nowMin - windowStart) / windowSpan) * 100}%`, transition: 'left 1s linear' }}
        />
        {withLanes.map((it) => {
          const left = Math.max(0, ((it.startMin - windowStart) / windowSpan) * 100)
          const right = Math.min(100, ((it.endMin - windowStart) / windowSpan) * 100)
          const width = Math.max(3, right - left)
          return (
            <div
              key={it.id}
              className={`absolute rounded-lg px-2 py-1 flex flex-col justify-center overflow-hidden ${
                it.state === 'live' ? 'bg-status-danger/80 text-white' : 'bg-primary/70 text-primary-foreground'
              }`}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                top: `${18 + it.lane * laneHeightPct}%`,
                height: `${laneHeightPct - 4}%`,
                transition: 'left 1s linear, width 1s linear, top 1s linear'
              }}
            >
              <span className="font-semibold text-xs sm:text-sm truncate">{it.label}</span>
              {it.liveScore && <span className="text-xs truncate">{it.liveScore}</span>}
              {formatRoomLine(t, it.room, it.awayRoom) && (
                <span className="text-[0.6rem] sm:text-xs opacity-80 truncate">{formatRoomLine(t, it.room, it.awayRoom)}</span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  function renderUpNext(items: BoardItem[]) {
    const upcoming = items.filter((it) => it.state !== 'finished').slice(0, 5)
    if (upcoming.length === 0) return <p className="text-text-muted text-sm">{t('rinkSchedule.boardNoUpcoming')}</p>
    return (
      <div className="flex flex-col gap-2">
        {upcoming.map((it) => (
          <div key={it.id} className="flex items-center justify-between gap-3">
            <span className="text-white font-medium truncate">{it.label}</span>
            <span className="text-text-muted text-xs sm:text-sm whitespace-nowrap">
              {minutesToTime(it.startMin)}–{minutesToTime(it.endMin)}
              {it.zoneLabel ? ` · ${it.zoneLabel}` : ''}
              {formatRoomLine(t, it.room, it.awayRoom) ? ` · ${formatRoomLine(t, it.room, it.awayRoom)}` : ''}
            </span>
          </div>
        ))}
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
            className="shrink-0 text-text-muted hover:text-primary text-xs sm:text-sm underline whitespace-nowrap"
          >
            {t('tournaments.backToStandardView')}
          </Link>
          <h1 className="flex-1 min-w-0 text-[clamp(1.1rem,3.2vw,3rem)] font-bold text-primary text-center truncate">
            {club?.name ?? t('rinkSchedule.title')}
          </h1>
          <span className="shrink-0 mono text-text-secondary text-sm sm:text-lg">{minutesToTime(nowMin)}</span>
        </div>

        <div className="flex-1 min-h-0 flex gap-3">
          {activeRinks.map((rink) => (
            <div key={rink.id} className="flex-1 min-w-0 flex flex-col rounded-2xl border border-border bg-background-card p-3 gap-2">
              <h2 className="shrink-0 text-white text-lg font-bold text-center truncate">{localizedName(rink, i18n.language)}</h2>
              {renderTimeline(itemsByRink.get(rink.id) ?? [])}
              <div className="shrink-0" style={{ height: '24vh' }}>
                <h3 className="text-text-muted text-xs uppercase tracking-wide mb-1">{t('rinkSchedule.upNext')}</h3>
                <ScaleToFit className="h-[calc(100%-1.25rem)] w-full">
                  {renderUpNext(itemsByRink.get(rink.id) ?? [])}
                </ScaleToFit>
              </div>
            </div>
          ))}
          <div className="shrink-0 rounded-2xl border border-border bg-background-card px-4 py-3 flex flex-col items-center justify-center gap-2" style={{ width: 'clamp(120px, 16vh, 220px)' }}>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="" className="w-full aspect-square bg-white p-1 rounded object-contain" style={{ maxHeight: 'clamp(100px, 14vh, 190px)' }} />
            ) : (
              <div className="w-full aspect-square bg-background-dark rounded" style={{ maxHeight: 'clamp(100px, 14vh, 190px)' }} />
            )}
            <p className="text-text-muted text-xs text-center">{t('rinkSchedule.boardScanHint')}</p>
          </div>
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
