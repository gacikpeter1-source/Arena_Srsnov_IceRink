import { CognitiveGameModule } from './types'
import { randomNumberModule } from './games/randomNumber'
import { mathProblemModule } from './games/mathProblem'
import { mathFormulasModule } from './games/mathFormulas'
import { circleCountingModule } from './games/circleCounting'

// Adding a new game = adding one more entry here (plus its matching
// generator in functions/src/cognitiveGames/registry.ts, registered under
// the same id) — CognitiveTrainingPage/CognitiveTvPage never need to
// change.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const modules: Record<string, CognitiveGameModule<any>> = {
  [randomNumberModule.id]: randomNumberModule,
  [mathProblemModule.id]: mathProblemModule,
  [mathFormulasModule.id]: mathFormulasModule,
  [circleCountingModule.id]: circleCountingModule
}

export function listCognitiveGames(): CognitiveGameModule<Record<string, unknown>>[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Object.values(modules) as CognitiveGameModule<any>[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCognitiveGameModule(gameId: string): CognitiveGameModule<any> | undefined {
  return modules[gameId]
}
