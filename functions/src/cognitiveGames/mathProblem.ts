import { CognitiveGameGenerator, GeneratedTask } from "./types";

// A real cognitive-training drill (unlike the randomNumber demo game) —
// a player sees a simple arithmetic problem ("3 + 5 = ?") and the trainer
// sees the same problem plus the correct answer. `content`/`correctAnswer`
// genuinely differ here, exercising the public/private split the demo
// game's identical content/answer never did.
export type MathOperation = "add" | "subtract";

export interface MathProblemConfig {
  taskCount: number;
  taskDurationSeconds: number;
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

export const mathProblemGenerator: CognitiveGameGenerator<MathProblemConfig> = {
  id: MATH_PROBLEM_GAME_ID,
  generate(config, rng): GeneratedTask[] {
    const operations: MathOperation[] = config.operations.length > 0 ? config.operations : ["add"];
    const tasks: GeneratedTask[] = [];
    for (let i = 0; i < config.taskCount; i++) {
      const operation = operations[randomInt(0, operations.length - 1, rng)];
      let a = randomInt(config.min, config.max, rng);
      let b = randomInt(config.min, config.max, rng);
      // Subtraction keeps the larger operand first, so a player never has
      // to reason about negative results — same simplification a basic
      // arithmetic drill for players mid-exercise already calls for.
      if (operation === "subtract" && b > a) {
        [a, b] = [b, a];
      }
      const correctAnswer = operation === "add" ? a + b : a - b;
      const content: MathProblemContent = { a, b, operation };
      tasks.push({ content, correctAnswer, durationMs: config.taskDurationSeconds * 1000 });
    }
    return tasks;
  }
};
