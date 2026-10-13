import { CognitiveGameGenerator, GeneratedTask } from "./types";
import { IntervalConfig, generateIntervalTasks } from "./engine";

export type MathOperation = "add" | "subtract" | "multiply" | "divide";

export interface MathProblemConfig extends IntervalConfig {
  min: number;
  max: number;
  operations: MathOperation[];
}

export interface MathProblemContent {
  a: number;
  b: number;
  operation: MathOperation;
}

export const MATH_PROBLEM_GAME_ID = "mathProblem";

function randomInt(min: number, max: number, rng: () => number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function buildProblem(config: MathProblemConfig, rng: () => number): { content: MathProblemContent; correctAnswer: number } {
  const operations: MathOperation[] = config.operations.length > 0 ? config.operations : ["add"];
  const operation = operations[randomInt(0, operations.length - 1, rng)];

  // Division is built backwards from a whole-number quotient so the
  // player always gets a clean integer result — never a remainder, and
  // never a division by zero. The divisor/quotient both stay within the
  // trainer's own configured range (same "skill level" range used for
  // every other operation); the dividend (a) can end up larger than
  // `max` as a result (it's just the bigger of the two numbers shown).
  if (operation === "divide") {
    const divisorMin = Math.max(1, config.min);
    const divisorMax = Math.max(divisorMin, config.max);
    const b = randomInt(divisorMin, divisorMax, rng);
    const quotient = randomInt(config.min, config.max, rng);
    const a = b * quotient;
    return { content: { a, b, operation }, correctAnswer: quotient };
  }

  let a = randomInt(config.min, config.max, rng);
  let b = randomInt(config.min, config.max, rng);

  if (operation === "subtract" && b > a) {
    [a, b] = [b, a];
  }

  const correctAnswer = operation === "add" ? a + b : operation === "subtract" ? a - b : a * b;

  return { content: { a, b, operation }, correctAnswer };
}

export const mathProblemGenerator: CognitiveGameGenerator<MathProblemConfig> = {
  id: MATH_PROBLEM_GAME_ID,
  generate(config, rng): GeneratedTask[] {
    return generateIntervalTasks(config, () => buildProblem(config, rng));
  }
};
