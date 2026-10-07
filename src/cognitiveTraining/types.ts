import { ComponentType } from 'react'

// The frontend half of a game plugin — generation (the other half of the
// contract) lives server-side only, in
// functions/src/cognitiveGames/registry.ts, registered under the same
// `id`; the two registries never need to agree on anything beyond that id
// string, since the frontend never generates tasks itself (see
// CLAUDE.md's "Kognitívny tréning" section for the full rationale).
export interface CognitiveGameModule<Config = Record<string, unknown>> {
  id: string
  // An i18n key (not a literal string) — resolved via t() wherever a game
  // picker renders it, same as every other translated label in this app.
  displayName: string
  // A config this game starts with in the trainer's create form, before
  // they've touched anything.
  defaultConfig: Config
  // The trainer's own config form — fully controlled (value/onChange), so
  // CognitiveTrainingPage never needs to know a single field this game's
  // config actually has.
  ConfigForm: ComponentType<{ value: Config; onChange: (value: Config) => void }>
  // What the TV shows for one 'task' phase's content — never given the
  // correct answer, by construction (the TV page only ever has access to
  // the public CognitiveSession doc, which never carries one).
  TvRenderer: ComponentType<{ content: unknown }>
  // What the trainer's phone shows for the current task — content AND the
  // correct answer together, since that's the whole point of the trainer
  // view.
  TrainerRenderer: ComponentType<{ content: unknown; correctAnswer: unknown }>
}
