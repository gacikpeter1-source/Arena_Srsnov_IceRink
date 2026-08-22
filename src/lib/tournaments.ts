import { collection, doc, deleteDoc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import { createBooking, cancelBooking, SlotUnavailableError } from './bookings'
import { DivisionMode, Tournament, TournamentMatch } from '@/types'

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

/** Cascades: cancels any booking a match blocked, deletes every match, then the tournament itself. */
export async function deleteTournament(tournamentId: string): Promise<void> {
  const matches = await fetchTournamentMatches(tournamentId)
  await Promise.all(matches.map((m) => deleteTournamentMatch(m.id, m)))
  await deleteDoc(doc(db, 'tournaments', tournamentId))
}

export interface CreateTournamentMatchInput {
  tournamentId: string
  clubId: string
  date: string
  startTime: string
  durationMinutes: number
  teamA: string
  teamB: string
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
