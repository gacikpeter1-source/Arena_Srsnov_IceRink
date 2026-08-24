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
  pointsForWin: number
  format: 'roundRobin' | 'knockout' | 'groups'
}

export async function createTournament(input: CreateTournamentInput): Promise<string> {
  const ref = doc(collection(db, 'tournaments'))
  await setDoc(ref, {
    clubId: input.clubId,
    name: input.name,
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    pointsForWin: input.pointsForWin,
    format: input.format,
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

/** Single-tournament lookup for TournamentDetailPage.tsx, reading its id straight from the /admin/turnaje/:tournamentId route param. */
export async function fetchTournament(tournamentId: string): Promise<(Tournament & { id: string }) | null> {
  const snap = await getDoc(doc(db, 'tournaments', tournamentId))
  if (!snap.exists()) return null
  return { ...(snap.data() as Omit<Tournament, 'id'>), id: snap.id }
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
 * Writes a whole team roster in one go — used by TournamentCreatePage.tsx's
 * setup wizard, where every team name is collected in local component
 * state (no `tournamentId` exists yet to write against) and only handed
 * to Firestore once, right after the tournament document itself is
 * created. Skips the per-name duplicate-name check createTournamentTeam
 * does, since the wizard already enforces uniqueness against its own
 * local list before this is ever called. Returns the created docs in the
 * same order as `names`, so the caller can line seed/group assignments
 * (built against local placeholder ids) back up with the real ones.
 */
export async function createTournamentTeamsBatch(
  tournamentId: string,
  clubId: string,
  names: string[]
): Promise<(TournamentTeam & { id: string })[]> {
  const created: (TournamentTeam & { id: string })[] = []
  for (const name of names) {
    const ref = doc(collection(db, 'tournamentTeams'))
    await setDoc(ref, { tournamentId, clubId, name, createdAt: serverTimestamp() })
    created.push({ id: ref.id, tournamentId, clubId, name, createdAt: new Date() })
  }
  return created
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

/**
 * Persists a Fáza D "groups + play-off" group assignment onto each team's
 * `groupId` — called at group-stage generation time, same "only written
 * once the trainer actually commits" timing setTeamSeedOrder already uses.
 */
export async function setTeamGroups(assignments: { id: string; groupId: string }[]): Promise<void> {
  await Promise.all(assignments.map(({ id, groupId }) => updateDoc(doc(db, 'tournamentTeams', id), { groupId })))
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
  // See TournamentMatch.schema — unset for a manually-added match.
  schema?: 'roundRobin' | 'knockout' | 'groups' | 'groupsPlayoff'
  // See TournamentMatch.groupId — only set for a 'groups' schema match.
  groupId?: string
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
    ...(input.schema ? { schema: input.schema } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
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

// A generated schedule's "zone index within a slot" (0, 1, 2, ...) needs
// to resolve to a real rink + zone at write time. Once a tournament could
// span more than one physical rink at once (see CLAUDE.md's "Multiple
// rinks" section), that resolution can no longer assume every zone
// belongs to the same rink — so every create*Schedule/createKnockoutBracket
// input takes a slotIndex-ordered list of (rinkId, zoneId) pairs instead
// of a single rinkId + a zoneIds array.
export interface ScheduleSlotLocation {
  rinkId: string
  zoneId: string
}

export interface CreateRoundRobinScheduleInput {
  tournamentId: string
  clubId: string
  date: string
  slotLocations: ScheduleSlotLocation[] // slotIndex-ordered — index 0 hosts each slot's first pair, etc.
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
      const location = input.slotLocations[zoneIdx]
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
        schema: 'roundRobin',
        format: input.format,
        location: 'rink',
        rinkId: location.rinkId,
        zoneId: location.zoneId,
        blocksIce: input.blocksIce,
        createdBy: input.createdBy,
        ...(input.blocksIce ? { bookingContact: input.bookingContact } : {})
      })
      created++
    }
  }
  return created
}

// ---------------------------------------------------------------------
// Groups + play-off schedule generation (Fáza D) — teams are split into
// lettered groups, each group plays its own round-robin (reusing
// circleMethodRounds), then the top finishers from each group feed into a
// knockout bracket via the existing buildKnockoutPreview/
// createKnockoutBracket (tagged schema: 'groupsPlayoff' instead of
// 'knockout' so the two brackets never mix in a UI that shows both). See
// CLAUDE.md's "Tournaments" section for the full design rationale.
// ---------------------------------------------------------------------

export interface GroupsPreviewPair {
  groupId: string
  groupName: string
  teamAId: string
  teamAName: string
  teamBId: string
  teamBName: string
}

export interface GroupsPreviewSlot {
  index: number
  startTime: string
  pairs: GroupsPreviewPair[]
}

export interface GroupsPreview {
  slots: GroupsPreviewSlot[]
  totalMatches: number
  groups: { id: string; name: string; teamCount: number }[]
}

/**
 * Builds every group's own round-robin schedule and interleaves them into
 * shared time slots. Since groups partition the teams, two pairs from
 * *different* groups never share a team — so unlike a single round-robin's
 * chunking (which must never cross that one bracket's round boundary), any
 * pair from any group's next unscheduled round can safely share a slot
 * with any other group's, which is what lets groups of different sizes
 * finish their own rounds independently without leaving zones idle. Pure/
 * Firestore-free, mirroring buildRoundRobinPreview/buildKnockoutPreview so
 * the UI can recompute it live.
 */
export function buildGroupsPreview(
  groups: { id: string; name: string; teams: { id: string; name: string }[] }[],
  matchesPerSlot: number,
  startTime: string,
  durationMinutes: number,
  defaultBreakMinutes: number,
  gapOverrides: Record<number, number> = {}
): GroupsPreview {
  const perGroupRounds = groups.map((g) => ({ group: g, rounds: circleMethodRounds(g.teams.map((t) => t.id)) }))
  const maxRounds = Math.max(0, ...perGroupRounds.map((g) => g.rounds.length))
  const nameById = new Map(groups.flatMap((g) => g.teams.map((t) => [t.id, t.name] as const)))
  const slots: GroupsPreviewSlot[] = []
  let cursorMinutes = timeToMinutes(startTime)
  let totalMatches = 0

  for (let r = 0; r < maxRounds; r++) {
    const pairsThisRound: GroupsPreviewPair[] = []
    for (const { group, rounds } of perGroupRounds) {
      if (r >= rounds.length) continue
      const realPairs = rounds[r].filter(([a, b]) => a && b) as [string, string][]
      for (const [a, b] of realPairs) {
        pairsThisRound.push({ groupId: group.id, groupName: group.name, teamAId: a, teamAName: nameById.get(a) ?? '', teamBId: b, teamBName: nameById.get(b) ?? '' })
      }
    }
    for (let i = 0; i < pairsThisRound.length; i += Math.max(1, matchesPerSlot)) {
      const chunk = pairsThisRound.slice(i, i + Math.max(1, matchesPerSlot))
      const slotIndex = slots.length
      slots.push({ index: slotIndex, startTime: minutesToTime(cursorMinutes), pairs: chunk })
      totalMatches += chunk.length
      cursorMinutes += durationMinutes + (gapOverrides[slotIndex] ?? defaultBreakMinutes)
    }
  }

  return { slots, totalMatches, groups: groups.map((g) => ({ id: g.id, name: g.name, teamCount: g.teams.length })) }
}

export interface CreateGroupsScheduleInput {
  tournamentId: string
  clubId: string
  date: string
  slotLocations: ScheduleSlotLocation[]
  format: DivisionMode
  durationMinutes: number
  blocksIce: boolean
  createdBy: string
  bookingContact?: { name: string; email: string; phone: string; timezone: string }
  preview: GroupsPreview
}

/** Writes every match in a generated groups preview, one createTournamentMatch call per pair. */
export async function createGroupsSchedule(input: CreateGroupsScheduleInput): Promise<number> {
  let created = 0
  for (const slot of input.preview.slots) {
    for (let zoneIdx = 0; zoneIdx < slot.pairs.length; zoneIdx++) {
      const pair = slot.pairs[zoneIdx]
      const location = input.slotLocations[zoneIdx]
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
        schema: 'groups',
        groupId: pair.groupId,
        format: input.format,
        location: 'rink',
        rinkId: location.rinkId,
        zoneId: location.zoneId,
        blocksIce: input.blocksIce,
        createdBy: input.createdBy,
        ...(input.blocksIce ? { bookingContact: input.bookingContact } : {})
      })
      created++
    }
  }
  return created
}

export interface GroupStandingRow {
  teamId: string
  teamName: string
  // Every match involving this team scheduled in the group, decided or
  // not — lets the spectator screen show "2 of 5 played" while a group is
  // still in progress, distinct from `played` below.
  totalMatches: number
  played: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  points: number
}

/**
 * Points table (win/draw/loss), sorted by points, then goal difference
 * ("skóre"), then fewest matches played (a team with the same points/
 * difference from fewer games is ranked ahead, rewarding efficiency over
 * a team that needed more games to get there), then name as a final
 * tie-break. `pointsForWin` is set once per tournament at creation time
 * (`Tournament.pointsForWin`, default 3) — draw/loss stay the standard
 * 1/0 regardless, only the win value is configurable. Unlike a knockout
 * match, a group match is allowed to end in a draw (see
 * setGroupMatchResult) — only matches with both scores actually recorded
 * count towards `played`/goals/points, so an in-progress group's
 * standings are simply computed from whatever results exist so far.
 */
export function computeGroupStandings(
  teams: { id: string; name: string }[],
  matches: Pick<TournamentMatch, 'teamAId' | 'teamBId' | 'scoreA' | 'scoreB'>[],
  pointsForWin = 3
): GroupStandingRow[] {
  const rows = new Map<string, GroupStandingRow>(
    teams.map((t) => [
      t.id,
      { teamId: t.id, teamName: t.name, totalMatches: 0, played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 }
    ])
  )
  for (const m of matches) {
    if (!m.teamAId || !m.teamBId) continue
    const a = rows.get(m.teamAId)
    const b = rows.get(m.teamBId)
    if (!a || !b) continue
    a.totalMatches++
    b.totalMatches++
    if (m.scoreA == null || m.scoreB == null) continue
    a.played++
    b.played++
    a.goalsFor += m.scoreA
    a.goalsAgainst += m.scoreB
    b.goalsFor += m.scoreB
    b.goalsAgainst += m.scoreA
    if (m.scoreA > m.scoreB) {
      a.wins++
      a.points += pointsForWin
      b.losses++
    } else if (m.scoreA < m.scoreB) {
      b.wins++
      b.points += pointsForWin
      a.losses++
    } else {
      a.draws++
      b.draws++
      a.points += 1
      b.points += 1
    }
  }
  const result = Array.from(rows.values())
  result.forEach((r) => {
    r.goalDiff = r.goalsFor - r.goalsAgainst
  })
  result.sort((x, y) => y.points - x.points || y.goalDiff - x.goalDiff || x.played - y.played || x.teamName.localeCompare(y.teamName))
  return result
}

/**
 * Records a final score with no draw restriction and no auto-advance —
 * used for any match outside the knockout/groupsPlayoff bracket schemas
 * (a group match, a round-robin match, or a manually-added one), where
 * there's no nextMatchId to feed and a draw is a perfectly normal result.
 * Also usable to correct an already-finished match's score, same as
 * setTournamentMatchResult below.
 */
export async function setPlainMatchResult(matchId: string, scoreA: number, scoreB: number): Promise<void> {
  await updateDoc(doc(db, 'tournamentMatches', matchId), { scoreA, scoreB, status: 'finished' })
}

/**
 * Group-stage-specific name for setPlainMatchResult — a draw is valid
 * (group standings have a points column for exactly this) and there's no
 * nextMatchId to auto-advance into, since which teams advance to the
 * play-off is a separate explicit trainer action once the whole group is
 * done. Kept as its own export since TournamentGroupsGenerator.tsx reads
 * better calling this than the schema-neutral name.
 */
export async function setGroupMatchResult(matchId: string, scoreA: number, scoreB: number): Promise<void> {
  return setPlainMatchResult(matchId, scoreA, scoreB)
}

/**
 * Live match-day controls (see CLAUDE.md's "Live scoreboard" note) — a
 * plain status flip (used to mark a match as started) and a raw score
 * write with no validation, no draw check, no status change and no
 * auto-advance, so a knockout match can safely sit at a tied score while
 * still in progress. Only setTournamentMatchResult/setPlainMatchResult
 * (above/below) ever transition a match to 'finished', since only they
 * know how to validate + advance for their own schema.
 */
export async function setMatchStatus(matchId: string, status: 'scheduled' | 'live' | 'finished'): Promise<void> {
  await updateDoc(doc(db, 'tournamentMatches', matchId), { status })
}

export async function updateLiveMatchScore(matchId: string, scoreA: number, scoreB: number): Promise<void> {
  await updateDoc(doc(db, 'tournamentMatches', matchId), { scoreA, scoreB })
}

/**
 * Reads a match's live-control state, tolerating every match that existed
 * before the `status` field did: a match with a real score already
 * recorded (the old one-shot "Uložiť výsledok" flow, or a resolved
 * knockout bye) reads as 'finished' even though `status` was never
 * written for it; everything else without an explicit 'live'/'finished'
 * status reads as 'scheduled'.
 */
export function deriveMatchState(m: Pick<TournamentMatch, 'status' | 'winnerTeamId' | 'scoreA' | 'scoreB'>): 'scheduled' | 'live' | 'finished' {
  if (m.status === 'live') return 'live'
  if (m.status === 'finished' || m.winnerTeamId != null || (m.scoreA != null && m.scoreB != null)) return 'finished'
  return 'scheduled'
}

// ---------------------------------------------------------------------
// Knockout ("pavúk") schedule generation (Fáza C) — single elimination
// with byes/seeding and result-driven auto-advancement. See CLAUDE.md's
// "Tournaments" section for the full design rationale.
// ---------------------------------------------------------------------

function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

/**
 * Standard tournament bracket seeding order (1v16, 8v9, 5v12, 4v13, ... for
 * 16) via the usual recursive-doubling construction — keeps similarly-
 * skilled teams apart until later rounds instead of clustering them.
 */
function seedOrder(size: number): number[] {
  let seeds = [1, 2]
  while (seeds.length < size) {
    const m = seeds.length * 2 + 1
    const next: number[] = []
    for (const s of seeds) next.push(s, m - s)
    seeds = next
  }
  return seeds.slice(0, size)
}

export class KnockoutDrawError extends Error {
  constructor() {
    super('A knockout match cannot end in a draw.')
    this.name = 'KnockoutDrawError'
  }
}

export interface KnockoutTeamSlot {
  id: string | null
  name: string | null // null = not yet known (fed by a future round's result)
}

export interface KnockoutPreviewMatch {
  matchNumber: number
  round: number
  teamA: KnockoutTeamSlot
  teamB: KnockoutTeamSlot
  isBye: boolean
  startTime: string | null // null for a bye — never actually played, so never scheduled
  zoneIndex: number | null // position within its time slot, maps to zoneIds[zoneIndex] at creation
}

export interface KnockoutPreview {
  rounds: KnockoutPreviewMatch[][] // rounds[0] = first round, last = final
  bracketSize: number
  byeCount: number
  // Every distinct scheduled time slot across the whole bracket, in
  // order — lets the UI offer the same "edit this specific gap" control
  // buildRoundRobinPreview's slots give it, keyed the same way
  // gapOverrides expects.
  slots: { index: number; startTime: string }[]
}

/**
 * Builds the full bracket structure — every round, byes already resolved
 * and propagated, every real match assigned a time slot — with zero
 * Firestore access, so the UI can recompute it live as the trainer edits
 * team order/rink/format/times/breaks, same as buildRoundRobinPreview.
 *
 * Byes go to the top seeds first (the standard convention): with
 * `bracketSize - teams.length` byes, seed 1 gets a bye before seed 2,
 * etc., which falls out naturally from pairing the seed order 1-for-1
 * against `teams` (a seed beyond `teams.length` has no real team).
 */
export function buildKnockoutPreview(
  teams: { id: string; name: string }[],
  matchesPerSlot: number,
  startTime: string,
  durationMinutes: number,
  defaultBreakMinutes: number,
  gapOverrides: Record<number, number> = {}
): KnockoutPreview {
  const bracketSize = nextPowerOfTwo(teams.length)
  const seeds = seedOrder(bracketSize)
  const slotTeams: KnockoutTeamSlot[] = seeds.map((s) => {
    const team = teams[s - 1]
    return team ? { id: team.id, name: team.name } : { id: null, name: null }
  })
  const numRounds = Math.log2(bracketSize)

  const matches: { teamA: KnockoutTeamSlot; teamB: KnockoutTeamSlot; isBye: boolean }[][] = []
  let size = bracketSize / 2
  for (let r = 0; r < numRounds; r++) {
    matches.push(Array.from({ length: size }, () => ({ teamA: { id: null, name: null }, teamB: { id: null, name: null }, isBye: false })))
    size /= 2
  }
  for (let i = 0; i < matches[0].length; i++) {
    matches[0][i].teamA = slotTeams[2 * i]
    matches[0][i].teamB = slotTeams[2 * i + 1]
  }

  // Resolve byes round by round, propagating the sole known team into the
  // next round's slot before that round is examined in turn.
  for (let r = 0; r < numRounds; r++) {
    for (let i = 0; i < matches[r].length; i++) {
      const m = matches[r][i]
      const aKnown = m.teamA.id != null
      const bKnown = m.teamB.id != null
      if (aKnown !== bKnown) {
        m.isBye = true
        const winner = aKnown ? m.teamA : m.teamB
        if (r + 1 < numRounds) {
          const nextIndex = Math.floor(i / 2)
          const slotKey = i % 2 === 0 ? 'teamA' : 'teamB'
          matches[r + 1][nextIndex][slotKey] = winner
        }
      }
    }
  }

  // Stable match numbering by bracket position — independent of
  // scheduling order, so a "Winner of Match N" label always names the
  // same match regardless of how real matches get chunked into slots.
  let matchNumber = 0
  const numberOf: number[][] = matches.map((round) => round.map(() => ++matchNumber))

  // Schedule real (non-bye) matches into time slots, chunked by
  // matchesPerSlot within each round — never crossing a round boundary,
  // since two pairs from different rounds could share a team.
  let cursorMinutes = timeToMinutes(startTime)
  let slotIndex = 0
  const startTimeOf: (string | null)[][] = matches.map((round) => round.map(() => null))
  const zoneIndexOf: (number | null)[][] = matches.map((round) => round.map(() => null))
  const slots: { index: number; startTime: string }[] = []
  for (let r = 0; r < matches.length; r++) {
    const realIndices = matches[r].map((_, i) => i).filter((i) => !matches[r][i].isBye)
    for (let chunkStart = 0; chunkStart < realIndices.length; chunkStart += Math.max(1, matchesPerSlot)) {
      const chunk = realIndices.slice(chunkStart, chunkStart + Math.max(1, matchesPerSlot))
      const slotStartTime = minutesToTime(cursorMinutes)
      chunk.forEach((i, zoneIdx) => {
        startTimeOf[r][i] = slotStartTime
        zoneIndexOf[r][i] = zoneIdx
      })
      slots.push({ index: slotIndex, startTime: slotStartTime })
      cursorMinutes += durationMinutes + (gapOverrides[slotIndex] ?? defaultBreakMinutes)
      slotIndex++
    }
  }

  const rounds: KnockoutPreviewMatch[][] = matches.map((round, r) =>
    round.map((m, i) => ({
      matchNumber: numberOf[r][i],
      round: r,
      teamA: m.teamA,
      teamB: m.teamB,
      isBye: m.isBye,
      startTime: startTimeOf[r][i],
      zoneIndex: zoneIndexOf[r][i]
    }))
  )

  return { rounds, bracketSize, byeCount: bracketSize - teams.length, slots }
}

export interface CreateKnockoutBracketInput {
  tournamentId: string
  clubId: string
  date: string
  slotLocations: ScheduleSlotLocation[] // slotIndex-ordered
  format: DivisionMode
  durationMinutes: number
  blocksIce: boolean
  createdBy: string
  bookingContact?: { name: string; email: string; phone: string; timezone: string }
  preview: KnockoutPreview
  // Renders the display text for a not-yet-known slot (e.g. "Winner of
  // Match #3") — supplied by the caller since this library stays
  // i18n-free; the resolved string is what actually gets persisted onto
  // TournamentMatch.teamA/teamB, same as any other free-text match name.
  resolvePlaceholder: (matchNumber: number) => string
  // 'groupsPlayoff' for Fáza D's play-off stage (fed by group standings
  // rather than the raw team roster) so it never mixes with a standalone
  // 'knockout' bracket in the UI that lists each separately. Defaults to
  // 'knockout'.
  schema?: 'knockout' | 'groupsPlayoff'
}

/**
 * Writes the entire bracket in one pass. Every match's Firestore ref is
 * pre-generated before any write happens, so nextMatchId can be wired
 * from an earlier round to a later one without needing a second update —
 * and since buildKnockoutPreview already resolved+propagated byes, a bye
 * match's own winnerTeamId and the next round's inherited team are both
 * known and written directly, with no follow-up write needed either.
 */
export async function createKnockoutBracket(input: CreateKnockoutBracketInput): Promise<number> {
  const { rounds } = input.preview
  const refs = rounds.map((round) => round.map(() => doc(collection(db, 'tournamentMatches'))))
  let created = 0

  for (let r = 0; r < rounds.length; r++) {
    for (let i = 0; i < rounds[r].length; i++) {
      const m = rounds[r][i]
      const nextRef = r + 1 < refs.length ? refs[r + 1][Math.floor(i / 2)] : null
      const nextMatchSlot: 'A' | 'B' | undefined = nextRef ? (i % 2 === 0 ? 'A' : 'B') : undefined

      const teamAKnown = m.teamA.id != null
      const teamBKnown = m.teamB.id != null
      const teamAName = m.teamA.name ?? input.resolvePlaceholder(m.matchNumber)
      const teamBName = m.teamB.name ?? input.resolvePlaceholder(m.matchNumber)

      const location = m.zoneIndex != null ? input.slotLocations[m.zoneIndex] : undefined

      let bookingId: string | undefined
      const shouldBlock = input.blocksIce && !m.isBye && teamAKnown && teamBKnown && m.startTime && location
      if (shouldBlock && input.bookingContact) {
        const createdBooking = await createBooking({
          clubId: input.clubId,
          rinkId: location!.rinkId,
          zoneId: location!.zoneId,
          date: input.date,
          startTime: m.startTime!,
          durationMinutes: input.durationMinutes,
          name: input.bookingContact.name,
          email: input.bookingContact.email,
          phone: input.bookingContact.phone,
          timezone: input.bookingContact.timezone
        })
        bookingId = createdBooking.id
      }

      await setDoc(refs[r][i], {
        tournamentId: input.tournamentId,
        clubId: input.clubId,
        date: input.date,
        startTime: m.startTime ?? '00:00',
        durationMinutes: input.durationMinutes,
        teamA: teamAName,
        teamB: teamBName,
        ...(teamAKnown ? { teamAId: m.teamA.id } : {}),
        ...(teamBKnown ? { teamBId: m.teamB.id } : {}),
        matchNumber: m.matchNumber,
        round: m.round,
        schema: input.schema ?? 'knockout',
        isBye: m.isBye,
        ...(m.isBye ? { winnerTeamId: (teamAKnown ? m.teamA.id : m.teamB.id) as string } : {}),
        format: input.format,
        location: 'rink',
        ...(!m.isBye && location ? { rinkId: location.rinkId, zoneId: location.zoneId } : {}),
        blocksIce: !!bookingId,
        ...(bookingId ? { bookingId } : {}),
        ...(nextRef ? { nextMatchId: nextRef.id, nextMatchSlot } : {}),
        createdBy: input.createdBy,
        createdAt: serverTimestamp()
      })
      created++
    }
  }
  return created
}

/**
 * Records a knockout match's result and auto-advances the winner into
 * the next match's slot (see nextMatchId/nextMatchSlot, set at bracket
 * generation time) — a knockout can't end in a draw, since there'd be no
 * way to decide who advances.
 */
export async function setTournamentMatchResult(matchId: string, scoreA: number, scoreB: number): Promise<void> {
  if (scoreA === scoreB) throw new KnockoutDrawError()
  const snap = await getDoc(doc(db, 'tournamentMatches', matchId))
  if (!snap.exists()) throw new Error('Match not found')
  const match = snap.data() as TournamentMatch
  if (!match.teamAId || !match.teamBId) throw new Error('Both teams must be known before recording a result')

  const winnerTeamId = scoreA > scoreB ? match.teamAId : match.teamBId
  const winnerName = scoreA > scoreB ? match.teamA : match.teamB

  await updateDoc(doc(db, 'tournamentMatches', matchId), { scoreA, scoreB, winnerTeamId, status: 'finished' })
  if (match.nextMatchId && match.nextMatchSlot) {
    const field = match.nextMatchSlot === 'A' ? 'teamAId' : 'teamBId'
    const nameField = match.nextMatchSlot === 'A' ? 'teamA' : 'teamB'
    await updateDoc(doc(db, 'tournamentMatches', match.nextMatchId), { [field]: winnerTeamId, [nameField]: winnerName })
  }
}
