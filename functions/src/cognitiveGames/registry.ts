import { CognitiveGameGenerator } from "./types";
import { randomNumberGenerator } from "./randomNumber";
import { mathProblemGenerator } from "./mathProblem";
import { mathFormulasGenerator } from "./mathFormulas";
import { circleCountingGenerator } from "./circleCounting";

// Adding a new game = adding one more entry here (plus its matching
// frontend module in src/cognitiveTraining/gameRegistry.ts, registered
// under the same id) — startCognitiveSession never needs to change.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const generators: Record<string, CognitiveGameGenerator<any>> = {
  [randomNumberGenerator.id]: randomNumberGenerator,
  [mathProblemGenerator.id]: mathProblemGenerator,
  [mathFormulasGenerator.id]: mathFormulasGenerator,
  [circleCountingGenerator.id]: circleCountingGenerator
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getGameGenerator(gameId: string): CognitiveGameGenerator<any> | undefined {
  return generators[gameId];
}
