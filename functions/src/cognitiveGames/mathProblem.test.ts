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
    taskCount: 5,
    taskDurationSeconds: 6,
    min: 1,
    max: 10,
    operations: ["add"]
  };

  it("generates exactly taskCount tasks", () => {
    const tasks = mathProblemGenerator.generate(baseConfig, mulberry32(1));
    expect(tasks).toHaveLength(5);
  });

  it("every task's duration matches taskDurationSeconds, in ms", () => {
    const tasks = mathProblemGenerator.generate(baseConfig, mulberry32(1));
    for (const task of tasks) {
      expect(task.durationMs).toBe(6000);
    }
  });

  it("addition-only config: correctAnswer is always a + b, operands within range", () => {
    const tasks = mathProblemGenerator.generate({ ...baseConfig, taskCount: 50 }, mulberry32(7));
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
      { ...baseConfig, taskCount: 50, operations: ["subtract"] },
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

  it("mixed operations: every task uses one of the configured operations", () => {
    const tasks = mathProblemGenerator.generate(
      { ...baseConfig, taskCount: 50, operations: ["add", "subtract"] },
      mulberry32(5)
    );
    const seen = new Set(tasks.map((t) => (t.content as MathProblemContent).operation));
    for (const op of seen) {
      expect(["add", "subtract"]).toContain(op);
    }
    // With 50 tasks and two equally-likely operations, both should show up.
    expect(seen.size).toBe(2);
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
