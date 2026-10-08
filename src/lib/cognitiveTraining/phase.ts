import { CognitivePhase } from '@/types'

// How long every device counts down before phase 0 begins — chosen once,
// server-side, when startCognitiveSession picks `startAt = serverNow +
// COGNITIVE_COUNTDOWN_MS` (functions/src/index.ts). Duplicated here (not
// imported) since functions/ is a separate TypeScript project from src/
// and can't import across that boundary — same reason this app's
// zonedTimeToUtc has a standalone ported copy in functions/src/index.ts
// (see CLAUDE.md). Keep both copies in sync if this ever changes.
export const COGNITIVE_COUNTDOWN_MS = 3000

export type CognitivePhaseState =
  | { kind: 'countdown'; msRemaining: number }
  | { kind: 'phase'; phaseIndex: number; phase: CognitivePhase; elapsedMs: number; remainingMs: number }
  | { kind: 'finished' }

/**
 * Pure function: given a session's generated plan, its chosen start
 * instant, and "now" (both already adjusted for this device's own
 * clockOffsetMs — see clockSync.ts), returns what the device should be
 * showing right now. No Firestore/network access here at all — this is
 * exactly what lets a TV/phone keep playing an exercise through a dropped
 * connection, since every device derives its own state purely from local
 * time against the one shared `startAt`.
 *
 * Phase boundaries are half-open ([start, end)) — at the exact instant a
 * phase ends, the device is already showing the next one.
 */
export function computeCurrentPhase(phases: CognitivePhase[], startAtMs: number, nowMs: number): CognitivePhaseState {
  if (nowMs < startAtMs) {
    return { kind: 'countdown', msRemaining: startAtMs - nowMs }
  }

  let cursor = startAtMs
  const elapsedSinceStart = nowMs - startAtMs
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i]
    const phaseStart = cursor - startAtMs
    const phaseEnd = phaseStart + phase.durationMs
    if (elapsedSinceStart < phaseEnd) {
      return {
        kind: 'phase',
        phaseIndex: i,
        phase,
        elapsedMs: elapsedSinceStart - phaseStart,
        remainingMs: phaseEnd - elapsedSinceStart
      }
    }
    cursor += phase.durationMs
  }
  return { kind: 'finished' }
}

/** Sum of every phase's duration — when a session is "finished" relative to startAt. */
export function totalPlanDurationMs(phases: CognitivePhase[]): number {
  return phases.reduce((sum, p) => sum + p.durationMs, 0)
}
