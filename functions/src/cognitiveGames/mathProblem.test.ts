import { describe, it, expect } from "vitest";
import { mathProblemGenerator, MathProblemConfig, MathProblemContent } from "./mathProblem";

// Same seeded PRNG as randomNumber.test.ts — see that file's own comment.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("mathProblemGenerator", () => {
  const baseConfig: MathProblemConfig = {
    intervalDurationSeconds: 30,
    intervalCount: 1,
    taskDurationSeconds: 6,
    restDurationSeconds: 15,
    min: 1,
    max: 10,
    operations: ["add"]
  };

  it("generates intervalCount * tasksPerInterval tasks (30s / 6s = 5, x1 round)", () => {
    const tasks = mathProblemGenerator.generate(baseConfig, mulberry32(1));
    expect(tasks).toHaveLength(5);
  });

  it("multiple rounds multiply the task count", () => {
    const tasks = mathProblemGenerator.generate({ ...baseConfig, intervalCount: 4 }, mulberry32(1));
    expect(tasks).toHaveLength(5 * 4);
  });

  it("every task's duration matches taskDurationSeconds, in ms", () => {
    const tasks = mathProblemGenerator.generate(baseConfig, mulberry32(1));
    for (const task of tasks) {
      expect(task.durationMs).toBe(6000);
    }
  });

  it("flags only the last task of each round as roundEnd", () => {
    const tasks = mathProblemGenerator.generate({ ...baseConfig, intervalCount: 3 }, mulberry32(1));
    expect(tasks.map((t) => t.roundEnd)).toEqual([false, false, false, false, true, false, false, false, false, true, false, false, false, false, true]);
  });

  it("addition-only config: correctAnswer is always a + b, operands within range", () => {
    const tasks = mathProblemGenerator.generate({ ...baseConfig, intervalCount: 10 }, mulberry32(7));
    for (const task of tasks) {
      const { a, b, operation } = task.content as MathProblemContent;
      expect(operation).toBe("add");
      expect(a).toBeGreaterThanOrEqual(baseConfig.min);
      expect(a).toBeLessThanOrEqual(baseConfig.max);
      expect(b).toBeGreaterThanOrEqual(baseConfig.min);
      expect(b).toBeLessThanOrEqual(baseConfig.max);
      expect(task.correctAnswer).toBe(a + b);
    }
  });

  it("subtraction never produces a negative correctAnswer", () => {
    const tasks = mathProblemGenerator.generate(
      { ...baseConfig, intervalCount: 10, operations: ["subtract"] },
      mulberry32(11)
    );
    for (const task of tasks) {
      const { a, b, operation } = task.content as MathProblemContent;
      expect(operation).toBe("subtract");
      expect(a).toBeGreaterThanOrEqual(b);
      expect(task.correctAnswer).toBe(a - b);
      expect(task.correctAnswer as number).toBeGreaterThanOrEqual(0);
    }
  });

  it("multiplication: correctAnswer is always a * b, operands within range", () => {
    const tasks = mathProblemGenerator.generate(
      { ...baseConfig, intervalCount: 10, operations: ["multiply"] },
      mulberry32(3)
    );
    for (const task of tasks) {
      const { a, b, operation } = task.content as MathProblemContent;
      expect(operation).toBe("multiply");
      expect(a).toBeGreaterThanOrEqual(baseConfig.min);
      expect(a).toBeLessThanOrEqual(baseConfig.max);
      expect(b).toBeGreaterThanOrEqual(baseConfig.min);
      expect(b).toBeLessThanOrEqual(baseConfig.max);
      expect(task.correctAnswer).toBe(a * b);
    }
  });

  it("division: always a clean whole-number quotient, never divides by zero", () => {
    const tasks = mathProblemGenerator.generate(
      { ...baseConfig, intervalCount: 10, operations: ["divide"] },
      mulberry32(9)
    );
    for (const task of tasks) {
      const { a, b, operation } = task.content as MathProblemContent;
      expect(operation).toBe("divide");
      expect(b).toBeGreaterThan(0);
      expect(a % b).toBe(0);
      expect(task.correctAnswer).toBe(a / b);
      expect(task.correctAnswer as number).toBeGreaterThanOrEqual(baseConfig.min);
      expect(task.correctAnswer as number).toBeLessThanOrEqual(baseConfig.max);
    }
  });

  it("mixed operations: every task uses one of the configured operations", () => {
    const tasks = mathProblemGenerator.generate(
      { ...baseConfig, intervalCount: 10, operations: ["add", "subtract", "multiply", "divide"] },
      mulberry32(5)
    );
    const seen = new Set(tasks.map((t) => (t.content as MathProblemContent).operation));
    for (const op of seen) {
      expect(["add", "subtract", "multiply", "divide"]).toContain(op);
    }
    // With 50 tasks and four roughly-equally-likely operations, all four
    // should show up at least once.
    expect(seen.size).toBe(4);
  });

  it("an empty operations array falls back to addition", () => {
    const tasks = mathProblemGenerator.generate({ ...baseConfig, operations: [] }, mulberry32(2));
    for (const task of tasks) {
      expect((task.content as MathProblemContent).operation).toBe("add");
    }
  });

  it("is deterministic for a given rng seed", () => {
    const a = mathProblemGenerator.generate(baseConfig, mulberry32(42));
    const b = mathProblemGenerator.generate(baseConfig, mulberry32(42));
    expect(a).toEqual(b);
  });
});
