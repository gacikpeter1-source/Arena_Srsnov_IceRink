// Mirrors src/types/index.ts's CognitivePhase shape — duplicated, not
// imported, since functions/ is a separate TypeScript project from src/
// and can't import across that boundary (same reason zonedTimeToUtc has
// a standalone ported copy in functions/src/index.ts — see CLAUDE.md).
export interface CognitivePhase {
  index: number
  type: 'task' | 'pause'
  durationMs: number
  content: unknown
}

// One task a game's generator produced, before the engine (engine.ts)
// interleaves pauses between them and assigns final phase indexes.
export interface GeneratedTask {
  content: unknown
  correctAnswer: unknown
  durationMs: number
}

// The whole plugin contract a game must implement on the server side —
// generation only, since rendering (TV/trainer views) and the config form
// are a frontend-only concern (src/cognitiveTraining/gameRegistry.ts) with
// no server counterpart. `rng` is injected (not read from Math.random
// internally) specifically so a test can pass a seeded, deterministic one
// — see randomNumber.test.ts.
export interface CognitiveGameGenerator<Config = Record<string, unknown>> {
  id: string
  generate(config: Config, rng: () => number): GeneratedTask[]
}
