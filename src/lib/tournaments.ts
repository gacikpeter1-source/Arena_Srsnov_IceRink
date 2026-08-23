import { collection, doc, deleteDoc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import { createBooking, cancelBooking, SlotUnavailableError } from './bookings'
import { DivisionMode, Tournament, TournamentMatch, TournamentTeam } from '@/types'
import { minutesToTime, timeToMinutes } from './utils'

export { SlotUnavailableError }

// ---------------------------------------------------------------------
// Tournaments — a quick-planning tool for a trainer/assistant/owner to
// schedule matches without a full bracket/results system (see CLAUDE.md's
// "Tournaments" section). A Tournament is just a name; the real content
// is its TournamentMatch docs.
// ---------------------------------------------------------------------

export interface CreateTournamentInput {
  clubId: string
  name: string
  createdBy: string
  createdByName: string
}

export async function createTournament(input: CreateTournamentInput): Promise<string> {
  const ref = doc(collection(db, 'tournaments'))
  await setDoc(ref, {
    clubId: input.clubId,
    name: input.name,
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    createdAt: serverTimestamp()
  })
  return ref.id
}

export async function fetchTournaments(clubId: string): Promise<(Tournament & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'tournaments'), where('clubId', '==', clubId)))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Tournament & { id: string })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Cascades: cancels any booking a match blocked, deletes every match and team, then the tournament itself. */
export async function deleteTournament(tournamentId: string): Promise<void> {
  const [matches, teams] = await Promise.all([fetchTournamentMatches(tournamentId), fetchTournamentTeams(tournamentId)])
  await Promise.all(matches.map((m) => deleteTournamentMatch(m.id, m)))
  await Promise.all(teams.map((tm) => deleteTournamentTeam(tm.id)))
  await deleteDoc(doc(db, 'tournaments', tournamentId))
}

// ---------------------------------------------------------------------
// Teams — added manually or via Excel import (lib/excel.ts's
// parseTeamsWorkbook). A later phase uses this list to auto-generate a
// round-robin/knockout/groups schedule; for now it's just a roster.
// ---------------------------------------------------------------------

export class DuplicateTeamNameError extends Error {
  constructor(name: string) {
    super(`A team named "${name}" already exists in this tournament.`)
    this.name = 'DuplicateTeamNameError'
  }
}

export interface CreateTournamentTeamInput {
  tournamentId: string
  clubId: string
  name: string
}

export async function fetchTournamentTeams(tournamentId: string): Promise<(TournamentTeam & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'tournamentTeams'), where('tournamentId', '==', tournamentId)))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TournamentTeam & { id: string })
    .sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0) || a.name.localeCompare(b.name))
}

/**
 * Case-insensitive duplicate check against the tournament's existing
 * teams — throws DuplicateTeamNameError instead of silently creating a
 * second team with the same name, which would make a later auto-
 * generated schedule ambiguous about which team is which.
 */
export async function createTournamentTeam(input: CreateTournamentTeamInput): Promise<string> {
  const name = input.name.trim()
  const existing = await fetchTournamentTeams(input.tournamentId)
  if (existing.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    throw new DuplicateTeamNameError(name)
  }
  const ref = doc(collection(db, 'tournamentTeams'))
  await setDoc(ref, {
    tournamentId: input.tournamentId,
    clubId: input.clubId,
    name,
    createdAt: serverTimestamp()
  })
  return ref.id
}

export async function deleteTournamentTeam(teamId: string): Promise<void> {
  await deleteDoc(doc(db, 'tournamentTeams', teamId))
}

/**
 * Persists the trainer's chosen draw order (random shuffle or manual
 * reordering) onto each team's `seed` field, 1-based — so a later visit
 * (and a future bracket-seeding phase) can pick up the same order rather
 * than starting from scratch every time a schedule is regenerated.
 */
export async function setTeamSeedOrder(teamIdsInOrder: string[]): Promise<void> {
  await Promise.all(teamIdsInOrder.map((id, i) => updateDoc(doc(db, 'tournamentTeams', id), { seed: i + 1 })))
}

export interface CreateTournamentMatchInput {
  tournamentId: string
  clubId: string
  date: string
  startTime: string
  durationMinutes: number
  teamA: string
  teamB: string
  // Set when generated from the tournament's team roster — see
  // TournamentMatch.teamAId/teamBId.
  teamAId?: string
  teamBId?: string
  // Which generated time-slot this belongs to — see TournamentMatch.round.
  round?: number
  format: DivisionMode
  location: 'rink' | 'other'
  // Required when location === 'rink'.
  rinkId?: string
  zoneId?: string
  // Required when location === 'other' — e.g. a hokejbal/football pitch
  // this club doesn't otherwise manage a calendar for.
  venueName?: string
  // Only meaningful when location === 'rink' — whether this match's
  // rink/zone/time gets atomically reserved via the same booking
  // mechanism customers use (createBooking), so it can't be double-
  // booked from the public /book page. Left off, the match is purely a
  // planning record, same as how training sessions never touch ice
  // bookings — useful when the tournament actually runs on a different
  // surface the club doesn't manage here (hokejbal/football pitch), or
  // when the trainer simply wants the slot to stay open to the public.
  blocksIce: boolean
  createdBy: string
  // Required when blocksIce is true.
  bookingContact?: { name: string; email: string; phone: string; timezone: string }
}

export async function createTournamentMatch(input: CreateTournamentMatchInput): Promise<string> {
  let bookingId: string | undefined
  if (input.blocksIce && input.rinkId && input.zoneId && input.bookingContact) {
    const created = await createBooking({
      clubId: input.clubId,
      rinkId: input.rinkId,
      zoneId: input.zoneId,
      date: input.date,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes,
      name: input.bookingContact.name,
      email: input.bookingContact.email,
      phone: input.bookingContact.phone,
      timezone: input.bookingContact.timezone
    })
    bookingId = created.id
  }

  const ref = doc(collection(db, 'tournamentMatches'))
  await setDoc(ref, {
    tournamentId: input.tournamentId,
    clubId: input.clubId,
    date: input.date,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    teamA: input.teamA,
    teamB: input.teamB,
    ...(input.teamAId ? { teamAId: input.teamAId } : {}),
    ...(input.teamBId ? { teamBId: input.teamBId } : {}),
    ...(input.round != null ? { round: input.round } : {}),
    format: input.format,
    location: input.location,
    ...(input.location === 'rink' ? { rinkId: input.rinkId, zoneId: input.zoneId } : {}),
    ...(input.location === 'other' && input.venueName ? { venueName: input.venueName } : {}),
    blocksIce: input.blocksIce,
    ...(bookingId ? { bookingId } : {}),
    createdBy: input.createdBy,
    createdAt: serverTimestamp()
  })
  return ref.id
}

export async function fetchTournamentMatches(tournamentId: string): Promise<(TournamentMatch & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'tournamentMatches'), where('tournamentId', '==', tournamentId)))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TournamentMatch & { id: string })
    .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)))
}

/**
 * Deletes a match, releasing its blocked ice slot first if it had one —
 * pass the already-fetched match doc when available (e.g. from
 * deleteTournament's cascade) to avoid a redundant read.
 */
export async function deleteTournamentMatch(
  matchId: string,
  match?: Pick<TournamentMatch, 'blocksIce' | 'bookingId'>
): Promise<void> {
  const known = match ?? (await getDoc(doc(db, 'tournamentMatches', matchId))).data()
  if (known?.blocksIce && known.bookingId) {
    await cancelBooking(known.bookingId).catch(() => {
      // Best-effort — the booking may already be cancelled/gone.
    })
  }
  await deleteDoc(doc(db, 'tournamentMatches', matchId))
}

// ---------------------------------------------------------------------
// Round-robin schedule generation (Fáza B) — every team plays every
// other team exactly once. Uses the standard "circle method": one team
// stays fixed, the rest rotate one position each round, producing
// teams.length - 1 rounds of teams.length / 2 pairs each (a bye pairing
// with the padding `null` is dropped for an odd team count).
// ---------------------------------------------------------------------

function circleMethodRounds(teamIds: string[]): (string | null)[][][] {
  const teams: (string | null)[] = [...teamIds]
  if (teams.length % 2 !== 0) teams.push(null)
  const n = teams.length
  const fixed = teams[0]
  let rotating = teams.slice(1)
  const rounds: (string | null)[][][] = []
  for (let r = 0; r < n - 1; r++) {
    const roundTeams = [fixed, ...rotating]
    const pairs: (string | null)[][] = []
    for (let i = 0; i < n / 2; i++) {
      pairs.push([roundTeams[i], roundTeams[n - 1 - i]])
    }
    rounds.push(pairs)
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)]
  }
  return rounds
}

export interface RoundRobinPreviewPair {
  teamAId: string
  teamAName: string
  teamBId: string
  teamBName: string
}

export interface RoundRobinPreviewSlot {
  index: number
  startTime: string
  pairs: RoundRobinPreviewPair[]
}

export interface RoundRobinPreview {
  slots: RoundRobinPreviewSlot[]
  totalMatches: number
}

/**
 * Flattens circle-method rounds into time slots of at most
 * `matchesPerSlot` simultaneous matches (one per parallel zone) each —
 * chunking never crosses a round boundary, since two pairs from
 * different rounds could otherwise share a team and end up scheduled at
 * the same time. `gapOverrides` (slot index -> minutes) lets the trainer
 * stretch one specific gap (e.g. a lunch break) beyond `defaultBreakMinutes`.
 * Pure/no Firestore access, so the UI can recompute this live as the
 * trainer edits inputs before committing anything.
 */
export function buildRoundRobinPreview(
  teams: { id: string; name: string }[],
  matchesPerSlot: number,
  startTime: string,
  durationMinutes: number,
  defaultBreakMinutes: number,
  gapOverrides: Record<number, number> = {}
): RoundRobinPreview {
  const rounds = circleMethodRounds(teams.map((t) => t.id))
  const nameById = new Map(teams.map((t) => [t.id, t.name]))
  const slots: RoundRobinPreviewSlot[] = []
  let cursorMinutes = timeToMinutes(startTime)
  let totalMatches = 0

  for (const round of rounds) {
    const realPairs = round.filter(([a, b]) => a && b) as [string, string][]
    for (let i = 0; i < realPairs.length; i += Math.max(1, matchesPerSlot)) {
      const chunk = realPairs.slice(i, i + Math.max(1, matchesPerSlot))
      const slotIndex = slots.length
      slots.push({
        index: slotIndex,
        startTime: minutesToTime(cursorMinutes),
        pairs: chunk.map(([a, b]) => ({ teamAId: a, teamAName: nameById.get(a) ?? '', teamBId: b, teamBName: nameById.get(b) ?? '' }))
      })
      totalMatches += chunk.length
      cursorMinutes += durationMinutes + (gapOverrides[slotIndex] ?? defaultBreakMinutes)
    }
  }

  return { slots, totalMatches }
}

export interface CreateRoundRobinScheduleInput {
  tournamentId: string
  clubId: string
  date: string
  rinkId: string
  zoneIds: string[] // slotIndex-ordered zone ids for the chosen format — index 0 hosts each slot's first pair, etc.
  format: DivisionMode
  durationMinutes: number
  blocksIce: boolean
  createdBy: string
  bookingContact?: { name: string; email: string; phone: string; timezone: string }
  preview: RoundRobinPreview
}

/** Writes every match in a generated preview — one createTournamentMatch call per pair, in slot order. */
export async function createRoundRobinSchedule(input: CreateRoundRobinScheduleInput): Promise<number> {
  let created = 0
  for (const slot of input.preview.slots) {
    for (let zoneIdx = 0; zoneIdx < slot.pairs.length; zoneIdx++) {
      const pair = slot.pairs[zoneIdx]
      await createTournamentMatch({
        tournamentId: input.tournamentId,
        clubId: input.clubId,
        date: input.date,
        startTime: slot.startTime,
        durationMinutes: input.durationMinutes,
        teamA: pair.teamAName,
        teamB: pair.teamBName,
        teamAId: pair.teamAId,
        teamBId: pair.teamBId,
        round: slot.index,
        format: input.format,
        location: 'rink',
        rinkId: input.rinkId,
        zoneId: input.zoneIds[zoneIdx],
        blocksIce: input.blocksIce,
        createdBy: input.createdBy,
        ...(input.blocksIce ? { bookingContact: input.bookingContact } : {})
      })
      created++
    }
  }
  return created
}
