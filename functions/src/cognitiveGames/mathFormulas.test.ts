import { describe, it, expect } from "vitest";
import { mathFormulasGenerator, MathFormulasConfig, MathFormulasContent, MATH_FORMULAS } from "./mathFormulas";

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

describe("mathFormulasGenerator", () => {
  const baseConfig: MathFormulasConfig = {
    intervalDurationSeconds: 30,
    intervalCount: 2,
    taskDurationSeconds: 5,
    restDurationSeconds: 15
  };

  it("generates intervalCount * tasksPerInterval tasks (30s / 5s = 6, x2 rounds)", () => {
    const tasks = mathFormulasGenerator.generate(baseConfig, mulberry32(1));
    expect(tasks).toHaveLength(12);
  });

  it("every task's content/correctAnswer come from the built-in formula bank", () => {
    const tasks = mathFormulasGenerator.generate(baseConfig, mulberry32(4));
    const keys = new Set(MATH_FORMULAS.map((f) => f.key));
    for (const task of tasks) {
      const content = task.content as MathFormulasContent;
      expect(keys.has(content.key)).toBe(true);
      expect(keys.has(task.correctAnswer as string)).toBe(true);
      expect(content.key).toBe(task.correctAnswer);
      const entry = MATH_FORMULAS.find((f) => f.key === content.key);
      expect(content.formula).toBe(entry?.formula);
    }
  });

  it("never repeats the same formula twice in a row", () => {
    const tasks = mathFormulasGenerator.generate({ ...baseConfig, intervalCount: 20 }, mulberry32(2));
    for (let i = 1; i < tasks.length; i++) {
      expect((tasks[i].content as MathFormulasContent).key).not.toBe((tasks[i - 1].content as MathFormulasContent).key);
    }
  });

  it("is deterministic for a given rng seed", () => {
    const a = mathFormulasGenerator.generate(baseConfig, mulberry32(42));
    const b = mathFormulasGenerator.generate(baseConfig, mulberry32(42));
    expect(a).toEqual(b);
  });
});
