import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where
} from 'firebase/firestore'
import { db } from './firebase'
import {
  TrainerIceLogEntry,
  TrainingBundle,
  TrainingBundleRegistration,
  TrainingFrequency,
  TrainingRegistration,
  TrainingSeries,
  TrainingSession,
  TrainingWalkIn
} from '@/types'
import { addDays, formatDateISO, generateConfirmationCode, generateToken } from './utils'
import { zonedTimeToUtc } from './ics'
import type { SupportedLanguage } from '@/i18n'

// ---------------------------------------------------------------------
// Trainer-facing creation/management — standalone sessions, recurring
// series ("opakované tréningy", register per occurrence), and bundles
// ("kurz"/"kemp", one registration covers every session). See CLAUDE.md's
// "Training reservations" section for the full design rationale.
// ---------------------------------------------------------------------

export const TRAINING_SERIES_MAX_OCCURRENCES: Record<TrainingFrequency, number> = {
  daily: 180,
  weekly: 52
}

export type TrainingSeriesRecurrence =
  | { type: 'count'; frequency: TrainingFrequency; count: number }
  | { type: 'until'; frequency: TrainingFrequency; endDate: string }

// Mirrors computeSeriesDates in lib/bookings.ts — kept as its own small
// copy rather than shared, matching this domain's "redesigned from
// scratch, not ported/shared" relationship to the ice-booking domain (see
// CLAUDE.md).
function computeOccurrenceDates(startDate: string, recurrence: TrainingSeriesRecurrence): string[] {
  const stepDays = recurrence.frequency === 'daily' ? 1 : 7
  const dates: string[] = []
  let d = new Date(`${startDate}T00:00:00`)
  if (recurrence.type === 'count') {
    for (let i = 0; i < recurrence.count; i++) {
      dates.push(formatDateISO(d))
      d = addDays(d, stepDays)
    }
  } else {
    const end = new Date(`${recurrence.endDate}T00:00:00`)
    while (d <= end) {
      dates.push(formatDateISO(d))
      d = addDays(d, stepDays)
    }
  }
  return dates
}

export interface CreateStandaloneSessionInput {
  clubId: string
  // Unset by an owner/superadmin creating a session shell without
  // assigning a trainer yet (see firestore.rules' trainingSessions create
  // rule, which allows isOwnerOrAbove() regardless of trainerId) — status
  // becomes 'unassigned' so any approved trainer can later claim it, same
  // as an Excel-imported row with no trainer name.
  trainerId?: string
  trainerName?: string
  date: string
  startTime: string
  durationMinutes: number
  capacity: number | null
  cancellationCutoffHours: number
}

export async function createStandaloneSession(input: CreateStandaloneSessionInput): Promise<string> {
  const ref = doc(collection(db, 'trainingSessions'))
  await setDoc(ref, {
    clubId: input.clubId,
    ...(input.trainerId ? { trainerId: input.trainerId, trainerName: input.trainerName } : {}),
    date: input.date,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    capacity: input.capacity,
    confirmedCount: 0,
    cancellationCutoffHours: input.cancellationCutoffHours,
    status: input.trainerId ? 'active' : 'unassigned',
    createdAt: serverTimestamp()
  })
  return ref.id
}

export interface CreateTrainingSeriesInput {
  clubId: string
  trainerId: string
  trainerName: string
  title: string
  startDate: string
  startTime: string
  durationMinutes: number
  capacity: number | null
  cancellationCutoffHours: number
  recurrence: TrainingSeriesRecurrence
}

/**
 * Creates the series metadata doc plus one independent trainingSessions
 * doc per occurrence — each carries its own confirmedCount/capacity (no
 * shared counter), since customers register per occurrence, not once for
 * the whole series (see TrainingSeries vs TrainingBundle in types).
 */
export async function createTrainingSeries(
  input: CreateTrainingSeriesInput
): Promise<{ seriesId: string; occurrenceCount: number }> {
  const dates = computeOccurrenceDates(input.startDate, input.recurrence)
  const max = TRAINING_SERIES_MAX_OCCURRENCES[input.recurrence.frequency]
  if (dates.length === 0) throw new Error('A recurring training needs at least one occurrence')
  if (dates.length > max) {
    throw new Error(`A ${input.recurrence.frequency} recurring training can span at most ${max} occurrences`)
  }

  const seriesRef = doc(collection(db, 'trainingSeries'))
  await setDoc(seriesRef, {
    clubId: input.clubId,
    trainerId: input.trainerId,
    trainerName: input.trainerName,
    title: input.title,
    frequency: input.recurrence.frequency,
    ...(input.recurrence.frequency === 'weekly'
      ? { dayOfWeek: new Date(`${input.startDate}T00:00:00`).getDay() }
      : {}),
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    capacity: input.capacity,
    cancellationCutoffHours: input.cancellationCutoffHours,
    createdAt: serverTimestamp()
  })

  await Promise.all(
    dates.map((date) =>
      setDoc(doc(collection(db, 'trainingSessions')), {
        clubId: input.clubId,
        trainerId: input.trainerId,
        trainerName: input.trainerName,
        date,
        startTime: input.startTime,
        durationMinutes: input.durationMinutes,
        capacity: input.capacity,
        confirmedCount: 0,
        cancellationCutoffHours: input.cancellationCutoffHours,
        seriesId: seriesRef.id,
        status: 'active',
        createdAt: serverTimestamp()
      })
    )
  )

  return { seriesId: seriesRef.id, occurrenceCount: dates.length }
}

export interface TrainingBundleSessionInput {
  date: string
  startTime: string
  durationMinutes: number
}

export interface CreateTrainingBundleInput {
  clubId: string
  trainerId: string
  trainerName: string
  title: string
  capacity: number | null
  cancellationCutoffHours: number
  sessions: TrainingBundleSessionInput[]
}

/**
 * Creates the bundle doc plus one trainingSessions doc per pre-scheduled
 * date — capacity/confirmedCount live on the bundle itself (shared across
 * every session it contains), not per session; each session's own
 * capacity/confirmedCount fields are a point-in-time denormalized copy for
 * display only (see TrainingSession.capacity) and are NOT kept in sync as
 * the bundle fills up — the calendar reads the bundle doc directly for a
 * bundle-linked session's real X/Y instead, so a registration only ever
 * has to touch the one bundle doc plus its own registration doc, not every
 * session in the bundle.
 */
export async function createTrainingBundle(input: CreateTrainingBundleInput): Promise<{ bundleId: string }> {
  if (input.sessions.length === 0) throw new Error('A course/camp needs at least one session')

  const bundleRef = doc(collection(db, 'trainingBundles'))
  await setDoc(bundleRef, {
    clubId: input.clubId,
    trainerId: input.trainerId,
    trainerName: input.trainerName,
    title: input.title,
    capacity: input.capacity,
    confirmedCount: 0,
    cancellationCutoffHours: input.cancellationCutoffHours,
    createdAt: serverTimestamp()
  })

  await Promise.all(
    input.sessions.map((s) =>
      setDoc(doc(collection(db, 'trainingSessions')), {
        clubId: input.clubId,
        trainerId: input.trainerId,
        trainerName: input.trainerName,
        date: s.date,
        startTime: s.startTime,
        durationMinutes: s.durationMinutes,
        capacity: input.capacity,
        confirmedCount: 0,
        cancellationCutoffHours: input.cancellationCutoffHours,
        bundleId: bundleRef.id,
        status: 'active',
        createdAt: serverTimestamp()
      })
    )
  )

  return { bundleId: bundleRef.id }
}

export async function fetchTrainerSessions(trainerId: string): Promise<(TrainingSession & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'trainingSessions'), where('trainerId', '==', trainerId)))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TrainingSession & { id: string })
    .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)))
}

export async function fetchTrainerSeries(trainerId: string): Promise<(TrainingSeries & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'trainingSeries'), where('trainerId', '==', trainerId)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TrainingSeries & { id: string })
}

export async function fetchTrainerBundles(trainerId: string): Promise<(TrainingBundle & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'trainingBundles'), where('trainerId', '==', trainerId)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TrainingBundle & { id: string })
}

export async function deleteTrainingSession(sessionId: string): Promise<void> {
  await deleteDoc(doc(db, 'trainingSessions', sessionId))
}

/**
 * Ice-attendance checklist: an assistant/owner/superadmin confirms the
 * assigned trainer actually showed up for this scheduled session,
 * independent of customer attendance (see TrainingSession.
 * trainerPresentConfirmed) — a payroll-support record only.
 */
export async function setSessionTrainerPresence(sessionId: string, present: boolean): Promise<void> {
  await updateDoc(doc(db, 'trainingSessions', sessionId), { trainerPresentConfirmed: present })
}

export async function deleteTrainingSeries(seriesId: string): Promise<void> {
  const sessions = await getDocs(query(collection(db, 'trainingSessions'), where('seriesId', '==', seriesId)))
  await Promise.all(sessions.docs.map((d) => deleteDoc(d.ref)))
  await deleteDoc(doc(db, 'trainingSeries', seriesId))
}

export async function deleteTrainingBundle(bundleId: string): Promise<void> {
  const sessions = await getDocs(query(collection(db, 'trainingSessions'), where('bundleId', '==', bundleId)))
  await Promise.all(sessions.docs.map((d) => deleteDoc(d.ref)))
  await deleteDoc(doc(db, 'trainingBundles', bundleId))
}

// ---------------------------------------------------------------------
// Public read (calendar, trainer directory)
// ---------------------------------------------------------------------

export async function fetchTrainingSessionsInRange(
  clubId: string,
  startDate: string,
  endDate: string
): Promise<(TrainingSession & { id: string })[]> {
  const snap = await getDocs(
    query(
      collection(db, 'trainingSessions'),
      where('clubId', '==', clubId),
      where('status', '==', 'active'),
      where('date', '>=', startDate),
      where('date', '<=', endDate)
    )
  )
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TrainingSession & { id: string })
    .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)))
}

export async function fetchTrainingBundlesByIds(
  bundleIds: string[]
): Promise<Map<string, TrainingBundle & { id: string }>> {
  const uniqueIds = Array.from(new Set(bundleIds))
  const snaps = await Promise.all(uniqueIds.map((id) => getDoc(doc(db, 'trainingBundles', id))))
  const map = new Map<string, TrainingBundle & { id: string }>()
  snaps.forEach((snap) => {
    if (snap.exists()) map.set(snap.id, { id: snap.id, ...snap.data() } as TrainingBundle & { id: string })
  })
  return map
}

// ---------------------------------------------------------------------
// Customer (no-login) registration — session-based. Same shape/lifecycle
// as ice bookings by design: capacity check + optional waitlist at
// creation, a pending/email-confirm anti-typo window, soft cancel,
// secure tokens (see CLAUDE.md).
//
// Capacity model: a 'pending' registration reserves a real spot
// immediately (confirmedCount is incremented at creation, same as ice
// bookings' slotLocks holding a slot during the pending window) — only a
// registration created while the session is already full goes straight to
// 'waitlist' without touching confirmedCount. Firestore's client SDK can
// only read documents (not run queries) inside a transaction, so an
// abandoned pending registration's reserved spot is released lazily and
// best-effort: reclaimExpiredSessionRegistrations runs a small
// non-transactional scan before each new registration attempt on that
// session, same "no scheduled cleanup job, self-heals on next touch"
// stance bookings already documents.
// ---------------------------------------------------------------------

export const TRAINING_PENDING_CONFIRMATION_MINUTES = 5

/**
 * Per-session variant of isPastCancellationCutoff (lib/bookings.ts) — each
 * trainer sets their own cancellationCutoffHours rather than sharing one
 * club-wide constant (see CLAUDE.md). firestore.rules enforces the same
 * check server-side on the trainingRegistrations status transition; this
 * is only the client-side mirror so the UI can hide/lock the cancel button
 * instead of surfacing a raw permission-denied error.
 */
export function isPastTrainingCancellationCutoff(
  date: string,
  startTime: string,
  timezone: string,
  cutoffHours: number
): boolean {
  const startUtc = zonedTimeToUtc(date, startTime, timezone)
  const cutoff = new Date(startUtc.getTime() - cutoffHours * 60 * 60 * 1000)
  return new Date() >= cutoff
}

export class SessionUnavailableError extends Error {
  constructor() {
    super('This session is no longer available.')
    this.name = 'SessionUnavailableError'
  }
}

export class TrainingConfirmationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrainingConfirmationError'
  }
}

async function reclaimExpiredSessionRegistrations(sessionId: string): Promise<void> {
  const staleSnap = await getDocs(
    query(collection(db, 'trainingRegistrations'), where('sessionId', '==', sessionId), where('status', '==', 'pending'))
  )
  const now = Date.now()
  const stale = staleSnap.docs.filter((d) => {
    const expiresAt = d.data().pendingExpiresAt as Timestamp | undefined
    return expiresAt != null && expiresAt.toMillis() < now
  })
  for (const regDoc of stale) {
    try {
      await runTransaction(db, async (tx) => {
        const regSnap = await tx.get(regDoc.ref)
        if (!regSnap.exists() || regSnap.data().status !== 'pending') return
        const sessionRef = doc(db, 'trainingSessions', sessionId)
        const sessionSnap = await tx.get(sessionRef)
        tx.update(regDoc.ref, { status: 'expired' })
        if (sessionSnap.exists()) {
          tx.update(sessionRef, { confirmedCount: Math.max(0, (sessionSnap.data().confirmedCount ?? 0) - 1) })
        }
      })
    } catch {
      // Best-effort — a race with another reclaim/registration is fine to skip.
    }
  }
}

export interface RegisterForSessionInput {
  clubId: string
  sessionId: string
  name: string
  email: string
  phone: string
  timezone: string
  // Staff manually registering a customer (e.g. a phone booking) skip the
  // pending email-confirm window and go straight to 'confirmed' — staff
  // already know the contact info is real, mirroring how
  // AdminCreateBookingModal's ice bookings work (see CLAUDE.md).
  instantConfirm?: boolean
  // The registrant's active browser language, stored on the registration
  // so a later automatic waitlist promotion can still email them in it —
  // see TrainingRegistration.language.
  language?: SupportedLanguage
}

export interface RegisteredForSession {
  id: string
  confirmationCode: string
  cancellationToken: string
  status: 'pending' | 'confirmed' | 'waitlist'
  waitlistPosition?: number
}

export async function registerForSession(input: RegisterForSessionInput): Promise<RegisteredForSession> {
  await reclaimExpiredSessionRegistrations(input.sessionId).catch(() => {})

  const waitlistSnap = await getDocs(
    query(collection(db, 'trainingRegistrations'), where('sessionId', '==', input.sessionId), where('status', '==', 'waitlist'))
  )
  const waitlistPositionGuess = waitlistSnap.size + 1

  const sessionRef = doc(db, 'trainingSessions', input.sessionId)
  const confirmationCode = generateConfirmationCode()
  const cancellationToken = generateToken()
  const tokenExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  const regRef = doc(collection(db, 'trainingRegistrations'))

  return runTransaction(db, async (tx) => {
    const sessionSnap = await tx.get(sessionRef)
    if (!sessionSnap.exists() || sessionSnap.data().status !== 'active') {
      throw new SessionUnavailableError()
    }
    const session = sessionSnap.data()
    const hasSpace = session.capacity === null || session.confirmedCount < session.capacity

    const base = {
      clubId: input.clubId,
      sessionId: input.sessionId,
      trainerId: session.trainerId,
      date: session.date,
      startTime: session.startTime,
      durationMinutes: session.durationMinutes,
      name: input.name,
      email: input.email,
      phone: input.phone,
      confirmationCode,
      cancellationToken,
      tokenExpiresAt,
      startAtUtc: zonedTimeToUtc(session.date, session.startTime, input.timezone),
      ...(input.language ? { language: input.language } : {}),
      createdAt: serverTimestamp()
    }

    if (hasSpace) {
      tx.update(sessionRef, { confirmedCount: session.confirmedCount + 1 })
      if (input.instantConfirm) {
        tx.set(regRef, { ...base, status: 'confirmed' })
        return { id: regRef.id, confirmationCode, cancellationToken, status: 'confirmed' as const }
      }
      const pendingExpiresAt = new Date(Date.now() + TRAINING_PENDING_CONFIRMATION_MINUTES * 60 * 1000)
      tx.set(regRef, { ...base, status: 'pending', pendingExpiresAt })
      return { id: regRef.id, confirmationCode, cancellationToken, status: 'pending' as const }
    }

    tx.set(regRef, { ...base, status: 'waitlist', waitlistPosition: waitlistPositionGuess })
    return { id: regRef.id, confirmationCode, cancellationToken, status: 'waitlist' as const, waitlistPosition: waitlistPositionGuess }
  })
}

/**
 * Confirms a still-pending session registration via its emailed link.
 * Idempotent on an already-confirmed registration (double-click / revisit).
 * If the 5-minute window already lapsed, marks it 'expired' and releases
 * the reserved spot instead of confirming — mirrors confirmBooking.
 */
export async function confirmSessionRegistration(
  registrationId: string,
  token: string
): Promise<{ registration: TrainingRegistration & { id: string }; alreadyConfirmed: boolean }> {
  const regRef = doc(db, 'trainingRegistrations', registrationId)

  return runTransaction(db, async (tx) => {
    const regSnap = await tx.get(regRef)
    if (!regSnap.exists()) throw new TrainingConfirmationError('Registration not found')
    const registration = regSnap.data() as Omit<TrainingRegistration, 'id'>
    if (registration.cancellationToken !== token) throw new TrainingConfirmationError('Invalid confirmation link')
    if (registration.status === 'confirmed') {
      return { registration: { id: registrationId, ...registration }, alreadyConfirmed: true }
    }
    if (registration.status !== 'pending') {
      throw new TrainingConfirmationError('This registration can no longer be confirmed')
    }

    const pendingExpiresAt = registration.pendingExpiresAt as unknown as Timestamp | undefined
    const isExpired = pendingExpiresAt != null && pendingExpiresAt.toMillis() < Date.now()
    const sessionRef = doc(db, 'trainingSessions', registration.sessionId)
    const sessionSnap = isExpired ? await tx.get(sessionRef) : null

    if (isExpired) {
      tx.update(regRef, { status: 'expired' })
      if (sessionSnap?.exists()) {
        tx.update(sessionRef, { confirmedCount: Math.max(0, (sessionSnap.data().confirmedCount ?? 0) - 1) })
      }
      throw new TrainingConfirmationError('This registration has expired')
    }

    tx.update(regRef, { status: 'confirmed' })
    return { registration: { id: registrationId, ...registration, status: 'confirmed' }, alreadyConfirmed: false }
  })
}

/**
 * After a cancellation frees a real spot, promotes whoever's been waiting
 * longest straight from 'waitlist' to 'confirmed' — never a silent auto-
 * move with no notice: the caller (TrainingCancelPage) queues the same
 * confirmation email an instant-confirm registration gets, using the
 * `language` captured at the promoted registrant's own signup time (there's
 * no browser session of theirs present to read it from now). This is
 * distinct from the still-unbuilt cross-notification feature (see
 * CLAUDE.md's "Planned but not yet built") — that one crosses between
 * different trainers' sessions/waitlists and always needs an explicit
 * claim click; this one is the same session freeing up its own spot, so
 * there's no ambiguity about what the customer signed up for.
 *
 * Firestore's client SDK can only read documents by reference inside a
 * transaction, not run a query (same constraint documented on
 * reclaimExpiredSessionRegistrations above) — so "who's next" is found via
 * a plain query first, then each candidate is tried in a small transaction
 * that re-checks both docs are still in the expected state before
 * committing. A candidate that lost a race (self-cancelled their waitlist
 * spot in the meantime) is skipped in favor of the next one, rather than
 * failing the whole promotion.
 */
async function promoteNextWaitlistedSessionRegistration(
  sessionId: string
): Promise<(TrainingRegistration & { id: string }) | null> {
  const waitlistSnap = await getDocs(
    query(collection(db, 'trainingRegistrations'), where('sessionId', '==', sessionId), where('status', '==', 'waitlist'))
  )
  const candidates = waitlistSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TrainingRegistration & { id: string })
    .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0))

  const sessionRef = doc(db, 'trainingSessions', sessionId)
  for (const candidate of candidates) {
    const regRef = doc(db, 'trainingRegistrations', candidate.id)
    const promoted = await runTransaction(db, async (tx) => {
      const sessionSnap = await tx.get(sessionRef)
      const regSnap = await tx.get(regRef)
      if (!sessionSnap.exists() || !regSnap.exists() || regSnap.data().status !== 'waitlist') return false
      const session = sessionSnap.data()
      if (session.capacity !== null && session.confirmedCount >= session.capacity) return false
      tx.update(sessionRef, { confirmedCount: session.confirmedCount + 1 })
      tx.update(regRef, { status: 'confirmed' })
      return true
    })
    if (promoted) return { ...candidate, status: 'confirmed' }
  }
  return null
}

/**
 * Cancels a session registration, releasing its reserved spot if it was
 * 'confirmed' or 'pending' (both hold a real spot — see the capacity-model
 * note above; a 'waitlist' registration never reserved one). When a real
 * spot was freed, also attempts to promote the next waitlisted registration
 * for the same session — returns it (or null if there was no one waiting,
 * or the promotion lost a race) so the caller can send the "you got a
 * spot" email.
 */
export async function cancelSessionRegistration(
  registrationId: string
): Promise<(TrainingRegistration & { id: string }) | null> {
  const regRef = doc(db, 'trainingRegistrations', registrationId)

  const sessionId = await runTransaction(db, async (tx) => {
    const regSnap = await tx.get(regRef)
    if (!regSnap.exists()) throw new Error('Registration not found')
    const registration = regSnap.data()
    if (registration.status === 'cancelled') throw new Error('Registration is already cancelled')

    const heldSpot = registration.status === 'confirmed' || registration.status === 'pending'
    const sessionRef = doc(db, 'trainingSessions', registration.sessionId)
    const sessionSnap = heldSpot ? await tx.get(sessionRef) : null

    tx.update(regRef, { status: 'cancelled', cancelledAt: serverTimestamp() })
    if (heldSpot && sessionSnap?.exists()) {
      tx.update(sessionRef, { confirmedCount: Math.max(0, (sessionSnap.data().confirmedCount ?? 0) - 1) })
    }
    return heldSpot ? (registration.sessionId as string) : null
  })

  return sessionId ? promoteNextWaitlistedSessionRegistration(sessionId) : null
}

export async function fetchSessionRegistrationsByEmail(
  sessionId: string,
  email: string
): Promise<(TrainingRegistration & { id: string })[]> {
  const snap = await getDocs(
    query(collection(db, 'trainingRegistrations'), where('sessionId', '==', sessionId), where('email', '==', email))
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TrainingRegistration & { id: string })
}

// ---------------------------------------------------------------------
// Customer (no-login) registration — bundle-based ("kurz"/"kemp"). One
// registration covers every session the bundle contains; capacity lives
// on the bundle doc alone, not per session (see TrainingBundle).
// ---------------------------------------------------------------------

async function reclaimExpiredBundleRegistrations(bundleId: string): Promise<void> {
  const staleSnap = await getDocs(
    query(collection(db, 'trainingBundleRegistrations'), where('bundleId', '==', bundleId), where('status', '==', 'pending'))
  )
  const now = Date.now()
  const stale = staleSnap.docs.filter((d) => {
    const expiresAt = d.data().pendingExpiresAt as Timestamp | undefined
    return expiresAt != null && expiresAt.toMillis() < now
  })
  for (const regDoc of stale) {
    try {
      await runTransaction(db, async (tx) => {
        const regSnap = await tx.get(regDoc.ref)
        if (!regSnap.exists() || regSnap.data().status !== 'pending') return
        const bundleRef = doc(db, 'trainingBundles', bundleId)
        const bundleSnap = await tx.get(bundleRef)
        tx.update(regDoc.ref, { status: 'expired' })
        if (bundleSnap.exists()) {
          tx.update(bundleRef, { confirmedCount: Math.max(0, (bundleSnap.data().confirmedCount ?? 0) - 1) })
        }
      })
    } catch {
      // Best-effort.
    }
  }
}

export interface RegisterForBundleInput {
  clubId: string
  bundleId: string
  name: string
  email: string
  phone: string
  // See RegisterForSessionInput.instantConfirm.
  instantConfirm?: boolean
  // See RegisterForSessionInput.language.
  language?: SupportedLanguage
}

export interface RegisteredForBundle {
  id: string
  confirmationCode: string
  cancellationToken: string
  status: 'pending' | 'confirmed' | 'waitlist'
  waitlistPosition?: number
}

export async function registerForBundle(input: RegisterForBundleInput): Promise<RegisteredForBundle> {
  await reclaimExpiredBundleRegistrations(input.bundleId).catch(() => {})

  const waitlistSnap = await getDocs(
    query(collection(db, 'trainingBundleRegistrations'), where('bundleId', '==', input.bundleId), where('status', '==', 'waitlist'))
  )
  const waitlistPositionGuess = waitlistSnap.size + 1

  const bundleRef = doc(db, 'trainingBundles', input.bundleId)
  const confirmationCode = generateConfirmationCode()
  const cancellationToken = generateToken()
  const tokenExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  const regRef = doc(collection(db, 'trainingBundleRegistrations'))

  return runTransaction(db, async (tx) => {
    const bundleSnap = await tx.get(bundleRef)
    if (!bundleSnap.exists()) throw new SessionUnavailableError()
    const bundle = bundleSnap.data()
    const hasSpace = bundle.capacity === null || bundle.confirmedCount < bundle.capacity

    const base = {
      clubId: input.clubId,
      bundleId: input.bundleId,
      trainerId: bundle.trainerId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      confirmationCode,
      cancellationToken,
      tokenExpiresAt,
      ...(input.language ? { language: input.language } : {}),
      createdAt: serverTimestamp()
    }

    if (hasSpace) {
      tx.update(bundleRef, { confirmedCount: bundle.confirmedCount + 1 })
      if (input.instantConfirm) {
        tx.set(regRef, { ...base, status: 'confirmed' })
        return { id: regRef.id, confirmationCode, cancellationToken, status: 'confirmed' as const }
      }
      const pendingExpiresAt = new Date(Date.now() + TRAINING_PENDING_CONFIRMATION_MINUTES * 60 * 1000)
      tx.set(regRef, { ...base, status: 'pending', pendingExpiresAt })
      return { id: regRef.id, confirmationCode, cancellationToken, status: 'pending' as const }
    }

    tx.set(regRef, { ...base, status: 'waitlist', waitlistPosition: waitlistPositionGuess })
    return { id: regRef.id, confirmationCode, cancellationToken, status: 'waitlist' as const, waitlistPosition: waitlistPositionGuess }
  })
}

export async function confirmBundleRegistration(
  registrationId: string,
  token: string
): Promise<{ registration: TrainingBundleRegistration & { id: string }; alreadyConfirmed: boolean }> {
  const regRef = doc(db, 'trainingBundleRegistrations', registrationId)

  return runTransaction(db, async (tx) => {
    const regSnap = await tx.get(regRef)
    if (!regSnap.exists()) throw new TrainingConfirmationError('Registration not found')
    const registration = regSnap.data() as Omit<TrainingBundleRegistration, 'id'>
    if (registration.cancellationToken !== token) throw new TrainingConfirmationError('Invalid confirmation link')
    if (registration.status === 'confirmed') {
      return { registration: { id: registrationId, ...registration }, alreadyConfirmed: true }
    }
    if (registration.status !== 'pending') {
      throw new TrainingConfirmationError('This registration can no longer be confirmed')
    }

    const pendingExpiresAt = registration.pendingExpiresAt as unknown as Timestamp | undefined
    const isExpired = pendingExpiresAt != null && pendingExpiresAt.toMillis() < Date.now()
    const bundleRef = doc(db, 'trainingBundles', registration.bundleId)
    const bundleSnap = isExpired ? await tx.get(bundleRef) : null

    if (isExpired) {
      tx.update(regRef, { status: 'expired' })
      if (bundleSnap?.exists()) {
        tx.update(bundleRef, { confirmedCount: Math.max(0, (bundleSnap.data().confirmedCount ?? 0) - 1) })
      }
      throw new TrainingConfirmationError('This registration has expired')
    }

    tx.update(regRef, { status: 'confirmed' })
    return { registration: { id: registrationId, ...registration, status: 'confirmed' }, alreadyConfirmed: false }
  })
}

/** Bundle counterpart of promoteNextWaitlistedSessionRegistration — same rationale/mechanism, scoped to trainingBundles/trainingBundleRegistrations. */
async function promoteNextWaitlistedBundleRegistration(
  bundleId: string
): Promise<(TrainingBundleRegistration & { id: string }) | null> {
  const waitlistSnap = await getDocs(
    query(collection(db, 'trainingBundleRegistrations'), where('bundleId', '==', bundleId), where('status', '==', 'waitlist'))
  )
  const candidates = waitlistSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TrainingBundleRegistration & { id: string })
    .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0))

  const bundleRef = doc(db, 'trainingBundles', bundleId)
  for (const candidate of candidates) {
    const regRef = doc(db, 'trainingBundleRegistrations', candidate.id)
    const promoted = await runTransaction(db, async (tx) => {
      const bundleSnap = await tx.get(bundleRef)
      const regSnap = await tx.get(regRef)
      if (!bundleSnap.exists() || !regSnap.exists() || regSnap.data().status !== 'waitlist') return false
      const bundle = bundleSnap.data()
      if (bundle.capacity !== null && bundle.confirmedCount >= bundle.capacity) return false
      tx.update(bundleRef, { confirmedCount: bundle.confirmedCount + 1 })
      tx.update(regRef, { status: 'confirmed' })
      return true
    })
    if (promoted) return { ...candidate, status: 'confirmed' }
  }
  return null
}

/** See cancelSessionRegistration — same shape, scoped to bundle registrations/bundles. */
export async function cancelBundleRegistration(
  registrationId: string
): Promise<(TrainingBundleRegistration & { id: string }) | null> {
  const regRef = doc(db, 'trainingBundleRegistrations', registrationId)

  const bundleId = await runTransaction(db, async (tx) => {
    const regSnap = await tx.get(regRef)
    if (!regSnap.exists()) throw new Error('Registration not found')
    const registration = regSnap.data()
    if (registration.status === 'cancelled') throw new Error('Registration is already cancelled')

    const heldSpot = registration.status === 'confirmed' || registration.status === 'pending'
    const bundleRef = doc(db, 'trainingBundles', registration.bundleId)
    const bundleSnap = heldSpot ? await tx.get(bundleRef) : null

    tx.update(regRef, { status: 'cancelled', cancelledAt: serverTimestamp() })
    if (heldSpot && bundleSnap?.exists()) {
      tx.update(bundleRef, { confirmedCount: Math.max(0, (bundleSnap.data().confirmedCount ?? 0) - 1) })
    }
    return heldSpot ? (registration.bundleId as string) : null
  })

  return bundleId ? promoteNextWaitlistedBundleRegistration(bundleId) : null
}

export async function fetchBundleRegistrationsByEmail(
  bundleId: string,
  email: string
): Promise<(TrainingBundleRegistration & { id: string })[]> {
  const snap = await getDocs(
    query(collection(db, 'trainingBundleRegistrations'), where('bundleId', '==', bundleId), where('email', '==', email))
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TrainingBundleRegistration & { id: string })
}

// ---------------------------------------------------------------------
// Attendance, walk-ins, trainer ice log — trainer's own check-in screens
// plus the club-oversight ice log. See CLAUDE.md's "Training reservations"
// section: "attendance" here means marking the CUSTOMER present, distinct
// from the reference app's confusing reuse of that word for trainer-
// presence validation.
// ---------------------------------------------------------------------

/** Full roster for a trainer's own session (any status) — used by the check-in screen. */
export async function fetchSessionRegistrations(sessionId: string): Promise<(TrainingRegistration & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'trainingRegistrations'), where('sessionId', '==', sessionId)))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TrainingRegistration & { id: string })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Full roster for a trainer's own bundle (any status) — one row per enrolled participant. */
export async function fetchBundleRegistrations(bundleId: string): Promise<(TrainingBundleRegistration & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'trainingBundleRegistrations'), where('bundleId', '==', bundleId)))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TrainingBundleRegistration & { id: string })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function markSessionAttendance(registrationId: string, checkedIn: boolean, checkedInBy: string): Promise<void> {
  await updateDoc(doc(db, 'trainingRegistrations', registrationId), {
    attendance: checkedIn ? { checkedIn: true, checkedInAt: serverTimestamp(), checkedInBy } : { checkedIn: false }
  })
}

/** Marks attendance for one real session within a bundle registration's attendanceBySession map. */
export async function markBundleSessionAttendance(
  registrationId: string,
  sessionId: string,
  checkedIn: boolean,
  checkedInBy: string
): Promise<void> {
  const regRef = doc(db, 'trainingBundleRegistrations', registrationId)
  const snap = await getDoc(regRef)
  if (!snap.exists()) throw new Error('Registration not found')
  const existing = (snap.data() as TrainingBundleRegistration).attendanceBySession ?? {}
  await updateDoc(regRef, {
    attendanceBySession: {
      ...existing,
      [sessionId]: checkedIn ? { checkedIn: true, checkedInAt: serverTimestamp(), checkedInBy } : { checkedIn: false }
    }
  })
}

export interface AddWalkInInput {
  clubId: string
  sessionId: string
  name: string
  notes?: string
  addedBy: string
}

export async function addWalkIn(input: AddWalkInInput): Promise<void> {
  await setDoc(doc(collection(db, 'trainingWalkIns')), {
    clubId: input.clubId,
    sessionId: input.sessionId,
    name: input.name,
    ...(input.notes ? { notes: input.notes } : {}),
    checkedInAt: serverTimestamp(),
    addedBy: input.addedBy
  })
}

export async function fetchWalkInsForSession(sessionId: string): Promise<(TrainingWalkIn & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'trainingWalkIns'), where('sessionId', '==', sessionId)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TrainingWalkIn & { id: string })
}

export async function deleteWalkIn(id: string): Promise<void> {
  await deleteDoc(doc(db, 'trainingWalkIns', id))
}

export interface AddTrainerIceLogInput {
  clubId: string
  // Unset when the assistant typed a free-text name instead of picking a
  // registered trainer — see TrainerIceLogEntry.
  trainerId?: string
  trainerName: string
  date: string
  // See TrainerIceLogEntry.time.
  time?: string
  notes?: string
  loggedBy: string
}

/**
 * Logged by an assistant/owner/superadmin when a trainer is seen using
 * club ice with no booked session at all — a club-oversight tool for
 * catching unauthorized private lessons. Deliberately NOT readable by the
 * trainer it's about (see firestore.rules) — surfaced in the training-
 * reservations area (not the ice-rink admin dashboard) since it's a
 * training-domain concern, but scoped to isStaffMember() there, not
 * isTrainer(), so a trainer never sees the logging control either.
 */
export async function addTrainerIceLogEntry(input: AddTrainerIceLogInput): Promise<void> {
  await setDoc(doc(collection(db, 'trainerIceLog')), {
    clubId: input.clubId,
    ...(input.trainerId ? { trainerId: input.trainerId } : {}),
    trainerName: input.trainerName,
    date: input.date,
    ...(input.time ? { time: input.time } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    loggedBy: input.loggedBy,
    loggedAt: serverTimestamp()
  })
}

/** Owner/superadmin only — firestore.rules rejects this read for anyone else, including the trainer it's about. */
export async function fetchTrainerIceLog(clubId: string): Promise<(TrainerIceLogEntry & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'trainerIceLog'), where('clubId', '==', clubId)))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TrainerIceLogEntry & { id: string })
    .sort((a, b) => b.date.localeCompare(a.date))
}

export async function deleteTrainerIceLogEntry(id: string): Promise<void> {
  await deleteDoc(doc(db, 'trainerIceLog', id))
}
