import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { CognitiveResult, CognitiveSession, CognitiveSessionAnswers } from '@/types'

// ---------------------------------------------------------------------
// Cognitive training ("Kognitívny tréning") — session creation/lifecycle
// and the per-player result log. See src/types/index.ts for the full data
// model rationale and firestore.rules for the matching access rules.
// ---------------------------------------------------------------------

function generatePairingCode(): string {
  // 6-digit, not 4 like Tournament.tvCode — this one is re-generated for
  // every single exercise (re-paired each time, per explicit product
  // direction) rather than once per tournament, so a larger codespace
  // keeps a same-moment collision across other clubs'/trainers' sessions
  // negligible without needing a wider retry budget.
  return String(Math.floor(100000 + Math.random() * 900000))
}

/** A code only ever resolves to whichever session most recently claimed it and hasn't finished/been cancelled yet — see fetchCognitiveSessionByCode. */
async function isPairingCodeInUse(code: string): Promise<boolean> {
  const snap = await getDocs(
    query(collection(db, 'cognitiveSessions'), where('pairingCode', '==', code), where('status', 'in', ['draft', 'started']))
  )
  return !snap.empty
}

export interface CreateDraftSessionInput {
  clubId: string
  trainerId: string
  gameId: string
  config: Record<string, unknown>
}

/**
 * Creates a new 'draft' session (game + config chosen, not started yet) with
 * a fresh pairing code the TV can connect to right away — re-paired per
 * exercise rather than once per practice, per explicit product direction
 * (pairing ahead of every single drill was accepted as simpler than a
 * standing TV-to-trainer pairing that outlives one exercise).
 */
export async function createDraftCognitiveSession(input: CreateDraftSessionInput): Promise<string> {
  let code = generatePairingCode()
  for (let attempt = 0; attempt < 5 && (await isPairingCodeInUse(code)); attempt++) {
    code = generatePairingCode()
  }

  const ref = doc(collection(db, 'cognitiveSessions'))
  await setDoc(ref, {
    clubId: input.clubId,
    trainerId: input.trainerId,
    gameId: input.gameId,
    config: input.config,
    pairingCode: code,
    status: 'draft',
    createdAt: serverTimestamp()
  })
  return ref.id
}

const startCognitiveSessionCallable = httpsCallable<{ sessionId: string }, { startAtMs: number; phases: unknown; totalDurationMs: number }>(
  functions,
  'startCognitiveSession'
)

/** Triggers plan generation (functions/src/index.ts's startCognitiveSession) — see CLAUDE.md for why this has to run server-side. */
export async function startCognitiveSession(sessionId: string): Promise<void> {
  await startCognitiveSessionCallable({ sessionId })
}

/** Trainer-initiated early stop — devices polling this session (see CognitiveTvPage/CognitiveTrainingPage) notice `status` changed and stop rendering further phases regardless of what the time-based computation would otherwise show. */
export async function endCognitiveSessionEarly(sessionId: string, wasStarted: boolean): Promise<void> {
  await updateDoc(doc(db, 'cognitiveSessions', sessionId), {
    status: wasStarted ? 'finished' : 'cancelled',
    endedAt: serverTimestamp()
  })
}

export async function fetchCognitiveSession(sessionId: string): Promise<(CognitiveSession & { id: string }) | null> {
  const snap = await getDoc(doc(db, 'cognitiveSessions', sessionId))
  if (!snap.exists()) return null
  return { ...(snap.data() as Omit<CognitiveSession, 'id'>), id: snap.id }
}

/** Resolves a pairing code to whichever session currently claims it — the TV's only way in, per CLAUDE.md. */
export async function fetchCognitiveSessionByCode(code: string): Promise<(CognitiveSession & { id: string }) | null> {
  const snap = await getDocs(
    query(
      collection(db, 'cognitiveSessions'),
      where('pairingCode', '==', code),
      where('status', 'in', ['draft', 'started']),
      orderBy('createdAt', 'desc'),
      limit(1)
    )
  )
  if (snap.empty) return null
  const d = snap.docs[0]
  return { ...(d.data() as Omit<CognitiveSession, 'id'>), id: d.id }
}

/** Trainer/staff-only — see firestore.rules. Returns null both when the plan hasn't been generated yet and when the caller isn't allowed to read it (both read as "no answers to show yet" from the UI's point of view). */
export async function fetchCognitiveSessionAnswers(sessionId: string): Promise<CognitiveSessionAnswers | null> {
  try {
    const snap = await getDoc(doc(db, 'cognitiveSessionAnswers', sessionId))
    if (!snap.exists()) return null
    return snap.data() as CognitiveSessionAnswers
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------
// Per-player results — deliberately minimal for this pass (see CLAUDE.md):
// one CognitiveResult doc per player per session, with a per-task
// correct/incorrect tally the trainer fills in live as each task resolves.
// ---------------------------------------------------------------------

/** Finds (or creates) this session's result row for one player, so the trainer's taps accumulate onto the same doc instead of creating a duplicate per tap. */
export async function fetchOrCreateCognitiveResult(clubId: string, sessionId: string, playerName: string): Promise<string> {
  const existing = await getDocs(
    query(collection(db, 'cognitiveResults'), where('sessionId', '==', sessionId), where('playerName', '==', playerName))
  )
  if (!existing.empty) return existing.docs[0].id

  const ref = doc(collection(db, 'cognitiveResults'))
  await setDoc(ref, { clubId, sessionId, playerName, perTask: [], createdAt: serverTimestamp() })
  return ref.id
}

/** Records (or corrects) one player's result for one task — overwrites any prior entry for that same task index rather than appending a duplicate. */
export async function recordCognitiveResultTask(resultId: string, taskIndex: number, correct: boolean): Promise<void> {
  const ref = doc(db, 'cognitiveResults', resultId)
  const snap = await getDoc(ref)
  const current = (snap.data()?.perTask as { index: number; correct: boolean }[] | undefined) ?? []
  const next = [...current.filter((t) => t.index !== taskIndex), { index: taskIndex, correct }].sort((a, b) => a.index - b.index)
  await updateDoc(ref, { perTask: next })
}

export async function fetchCognitiveResultsForSession(sessionId: string): Promise<(CognitiveResult & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'cognitiveResults'), where('sessionId', '==', sessionId)))
  return snap.docs.map((d) => ({ ...(d.data() as Omit<CognitiveResult, 'id'>), id: d.id }))
}

/** Recently-used player names for this club, for the free-text name field's `<datalist>` — same autocomplete-not-registry convention RinkScheduleEntry.teamName/TrainerIceLogEntry.trainerName already use. */
export async function fetchRecentCognitivePlayerNames(clubId: string): Promise<string[]> {
  const snap = await getDocs(query(collection(db, 'cognitiveResults'), where('clubId', '==', clubId), orderBy('createdAt', 'desc'), limit(100)))
  const names = new Set<string>()
  snap.docs.forEach((d) => names.add((d.data() as CognitiveResult).playerName))
  return Array.from(names)
}
