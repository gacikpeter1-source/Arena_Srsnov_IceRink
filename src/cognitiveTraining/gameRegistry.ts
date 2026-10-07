import { CognitiveGameModule } from './types'
import { randomNumberModule } from './games/randomNumber'

// Adding a new game = adding one more entry here (plus its matching
// generator in functions/src/cognitiveGames/registry.ts, registered under
// the same id) — CognitiveTrainingPage/CognitiveTvPage never need to
// change.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const modules: Record<string, CognitiveGameModule<any>> = {
  [randomNumberModule.id]: randomNumberModule
}

export function listCognitiveGames(): CognitiveGameModule<Record<string, unknown>>[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Object.values(modules) as CognitiveGameModule<any>[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCognitiveGameModule(gameId: string): CognitiveGameModule<any> | undefined {
  return modules[gameId]
}
