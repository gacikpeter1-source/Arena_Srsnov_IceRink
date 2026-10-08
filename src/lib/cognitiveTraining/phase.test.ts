import { describe, it, expect } from 'vitest'
import { computeCurrentPhase, totalPlanDurationMs } from './phase'
import { CognitivePhase } from '@/types'

const phases: CognitivePhase[] = [
  { index: 0, type: 'task', durationMs: 1000, content: { number: 1 } },
  { index: 1, type: 'pause', durationMs: 500, content: null },
  { index: 2, type: 'task', durationMs: 1000, content: { number: 2 } }
]
const startAt = 10_000

describe('computeCurrentPhase', () => {
  it('reports a countdown before startAt, with the exact ms remaining', () => {
    const state = computeCurrentPhase(phases, startAt, startAt - 1500)
    expect(state).toEqual({ kind: 'countdown', msRemaining: 1500 })
  })

  it('is in the first phase exactly at startAt, with zero elapsed', () => {
    const state = computeCurrentPhase(phases, startAt, startAt)
    expect(state).toEqual({
      kind: 'phase',
      phaseIndex: 0,
      phase: phases[0],
      elapsedMs: 0,
      remainingMs: 1000
    })
  })

  it('tracks elapsed/remaining mid-phase', () => {
    const state = computeCurrentPhase(phases, startAt, startAt + 400)
    expect(state).toEqual({
      kind: 'phase',
      phaseIndex: 0,
      phase: phases[0],
      elapsedMs: 400,
      remainingMs: 600
    })
  })

  it('a phase boundary is half-open: the exact end instant is already the next phase', () => {
    const state = computeCurrentPhase(phases, startAt, startAt + 1000)
    expect(state).toMatchObject({ kind: 'phase', phaseIndex: 1 })
  })

  it('moves correctly into the pause phase, then the final task phase', () => {
    const duringPause = computeCurrentPhase(phases, startAt, startAt + 1200)
    expect(duringPause).toEqual({
      kind: 'phase',
      phaseIndex: 1,
      phase: phases[1],
      elapsedMs: 200,
      remainingMs: 300
    })

    const duringLastTask = computeCurrentPhase(phases, startAt, startAt + 1500)
    expect(duringLastTask).toEqual({
      kind: 'phase',
      phaseIndex: 2,
      phase: phases[2],
      elapsedMs: 0,
      remainingMs: 1000
    })
  })

  it('is finished exactly at, and after, the total plan duration', () => {
    const total = totalPlanDurationMs(phases)
    expect(computeCurrentPhase(phases, startAt, startAt + total)).toEqual({ kind: 'finished' })
    expect(computeCurrentPhase(phases, startAt, startAt + total + 10_000)).toEqual({ kind: 'finished' })
  })

  it('an empty plan is immediately finished at startAt', () => {
    expect(computeCurrentPhase([], startAt, startAt)).toEqual({ kind: 'finished' })
  })
})

describe('totalPlanDurationMs', () => {
  it('sums every phase regardless of type', () => {
    expect(totalPlanDurationMs(phases)).toBe(2500)
  })

  it('is 0 for an empty plan', () => {
    expect(totalPlanDurationMs([])).toBe(0)
  })
})
