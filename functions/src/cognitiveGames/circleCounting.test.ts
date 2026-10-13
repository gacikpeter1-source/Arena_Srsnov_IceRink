import { describe, it, expect } from "vitest";
import { circleCountingGenerator, CircleCountingConfig, CircleCountingContent } from "./circleCounting";

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

describe("circleCountingGenerator", () => {
  const baseConfig: CircleCountingConfig = {
    intervalDurationSeconds: 20,
    intervalCount: 2,
    taskDurationSeconds: 4,
    restDurationSeconds: 10,
    minCircles: 10,
    maxCircles: 20,
    colors: ["red", "green", "blue"],
    targetColor: "green"
  };

  it("generates intervalCount * tasksPerInterval tasks (20s / 4s = 5, x2 rounds)", () => {
    const tasks = circleCountingGenerator.generate(baseConfig, mulberry32(1));
    expect(tasks).toHaveLength(10);
  });

  it("every task's circle count is within [minCircles, maxCircles]", () => {
    const tasks = circleCountingGenerator.generate(baseConfig, mulberry32(3));
    for (const task of tasks) {
      const { circles } = task.content as CircleCountingContent;
      expect(circles.length).toBeGreaterThanOrEqual(baseConfig.minCircles);
      expect(circles.length).toBeLessThanOrEqual(baseConfig.maxCircles);
    }
  });

  it("every circle's color is one of the configured colors", () => {
    const tasks = circleCountingGenerator.generate(baseConfig, mulberry32(5));
    for (const task of tasks) {
      const { circles } = task.content as CircleCountingContent;
      for (const c of circles) {
        expect(baseConfig.colors).toContain(c.color);
      }
    }
  });

  it("correctAnswer is exactly the count of targetColor circles", () => {
    const tasks = circleCountingGenerator.generate(baseConfig, mulberry32(7));
    for (const task of tasks) {
      const { circles, targetColor } = task.content as CircleCountingContent;
      expect(targetColor).toBe("green");
      const expected = circles.filter((c) => c.color === "green").length;
      expect(task.correctAnswer).toBe(expected);
    }
  });

  it("positions stay within the 4-96 percent bounds", () => {
    const tasks = circleCountingGenerator.generate(baseConfig, mulberry32(9));
    for (const task of tasks) {
      const { circles } = task.content as CircleCountingContent;
      for (const c of circles) {
        expect(c.x).toBeGreaterThanOrEqual(4);
        expect(c.x).toBeLessThanOrEqual(96);
        expect(c.y).toBeGreaterThanOrEqual(4);
        expect(c.y).toBeLessThanOrEqual(96);
      }
    }
  });

  it("falls back to a usable board if targetColor isn't among colors", () => {
    const tasks = circleCountingGenerator.generate({ ...baseConfig, colors: ["red", "blue"], targetColor: "green" }, mulberry32(2));
    for (const task of tasks) {
      const { circles, targetColor } = task.content as CircleCountingContent;
      expect(targetColor).toBe("red");
      for (const c of circles) {
        expect(["red", "blue"]).toContain(c.color);
      }
    }
  });

  it("is deterministic for a given rng seed", () => {
    const a = circleCountingGenerator.generate(baseConfig, mulberry32(42));
    const b = circleCountingGenerator.generate(baseConfig, mulberry32(42));
    expect(a).toEqual(b);
  });
});
