import { describe, it, expect } from "vitest";
import { randomNumberGenerator, RandomNumberConfig } from "./randomNumber";

// A tiny seeded PRNG (mulberry32) purely so these tests can assert exact,
// reproducible output — production code always calls the generator with
// real Math.random (see startCognitiveSession in index.ts), never this.
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

describe("randomNumberGenerator", () => {
  const baseConfig: RandomNumberConfig = { taskCount: 5, taskDurationSeconds: 4, min: 1, max: 20 };

  it("generates exactly taskCount tasks", () => {
    const tasks = randomNumberGenerator.generate(baseConfig, mulberry32(1));
    expect(tasks).toHaveLength(5);
  });

  it("every task's duration matches taskDurationSeconds, in ms", () => {
    const tasks = randomNumberGenerator.generate(baseConfig, mulberry32(1));
    for (const task of tasks) {
      expect(task.durationMs).toBe(4000);
    }
  });

  it("every number is within [min, max] and correctAnswer matches content.number", () => {
    const tasks = randomNumberGenerator.generate({ ...baseConfig, taskCount: 50 }, mulberry32(7));
    for (const task of tasks) {
      const content = task.content as { number: number };
      expect(content.number).toBeGreaterThanOrEqual(baseConfig.min);
      expect(content.number).toBeLessThanOrEqual(baseConfig.max);
      expect(task.correctAnswer).toBe(content.number);
    }
  });

  it("is deterministic for a given rng seed", () => {
    const a = randomNumberGenerator.generate(baseConfig, mulberry32(42));
    const b = randomNumberGenerator.generate(baseConfig, mulberry32(42));
    expect(a).toEqual(b);
  });

  it("a single-value range always returns that value", () => {
    const tasks = randomNumberGenerator.generate({ ...baseConfig, min: 7, max: 7, taskCount: 3 }, mulberry32(3));
    for (const task of tasks) {
      expect((task.content as { number: number }).number).toBe(7);
    }
  });
});
