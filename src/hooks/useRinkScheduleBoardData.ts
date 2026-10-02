import { useEffect, useState } from 'react'
import { useClubData } from './useClubData'
import { fetchBookingsInRange } from '@/lib/bookings'
import { fetchRinkScheduleEntries } from '@/lib/rinkSchedule'
import { fetchTournaments, fetchTournamentMatches, deriveMatchState } from '@/lib/tournaments'
import { formatDateISO, timeToMinutes, localizedName } from '@/lib/utils'
import { Booking, RinkScheduleEntry, TournamentMatch } from '@/types'

const POLL_MS = 30000
const CLOCK_TICK_MS = 30000

export interface BoardItem {
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

/**
 * Fetches and computes everything the "who has the ice when" board needs —
 * extracted out of RinkScheduleBoardPage so the alternating board
 * (RinkScheduleAlternatingBoardPage.tsx) can show the exact same live
 * schedule data without duplicating the fetch/poll/compute logic. Owns its
 * own polling (same `today`-recomputed-per-poll fix documented where this
 * logic originally lived) and a 30s clock tick for live/finished state.
 */
export function useRinkScheduleBoardData(lang: string) {
  const { club, rinks, zones } = useClubData()
  const [bookings, setBookings] = useState<(Booking & { id: string })[]>([])
  const [entries, setEntries] = useState<(RinkScheduleEntry & { id: string })[]>([])
  const [matches, setMatches] = useState<(TournamentMatch & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(new Date())

  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)

  // `refresh` deliberately recomputes "today" from a fresh `new Date()` on
  // every call, rather than closing over a `today` computed once at the
  // effect's own setup — see RinkScheduleBoardPage's original history for
  // the midnight bug this avoids.
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

  const zoneName = (zoneId: string) => {
    const zone = zones.find((z) => z.id === zoneId)
    return zone ? localizedName(zone, lang) : ''
  }
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

  return { club, zones, loading, now, nowMin, activeRinks, itemsByRink }
}
