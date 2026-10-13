import { describe, it, expect } from "vitest";
import {
  buildPlanFromTasks,
  buildIntervalPlanFromTasks,
  generateIntervalTasks,
  tasksPerInterval,
  totalPlanDurationMs,
  IntervalConfig
} from "./engine";
import { GeneratedTask } from "./types";

function task(content: unknown, correctAnswer: unknown, durationMs: number, roundEnd = false): GeneratedTask {
  return { content, correctAnswer, durationMs, roundEnd };
}

describe("buildPlanFromTasks", () => {
  it("interleaves a pause between tasks, but never after the last one", () => {
    const tasks = [task("a", 1, 1000), task("b", 2, 1000), task("c", 3, 1000)];
    const { phases } = buildPlanFromTasks(tasks, 500);
    expect(phases.map((p) => p.type)).toEqual(["task", "pause", "task", "pause", "task"]);
  });

  it("assigns sequential, gap-free indexes matching array position", () => {
    const tasks = [task("a", 1, 1000), task("b", 2, 1000)];
    const { phases } = buildPlanFromTasks(tasks, 500);
    phases.forEach((p, i) => expect(p.index).toBe(i));
  });

  it("omits pause phases entirely when pauseDurationMs is 0", () => {
    const tasks = [task("a", 1, 1000), task("b", 2, 1000)];
    const { phases } = buildPlanFromTasks(tasks, 0);
    expect(phases.map((p) => p.type)).toEqual(["task", "task"]);
  });

  it("preserves each task's own content/duration on its phase", () => {
    const tasks = [task({ number: 5 }, 5, 2500)];
    const { phases } = buildPlanFromTasks(tasks, 500);
    expect(phases[0]).toEqual({ index: 0, type: "task", durationMs: 2500, content: { number: 5 } });
  });

  it("answers align by index with their task phase, not with the answers array position", () => {
    const tasks = [task("a", "answerA", 1000), task("b", "answerB", 1000)];
    const { phases, answers } = buildPlanFromTasks(tasks, 500);
    const taskPhases = phases.filter((p) => p.type === "task");
    expect(answers).toEqual([
      { index: taskPhases[0].index, correctAnswer: "answerA" },
      { index: taskPhases[1].index, correctAnswer: "answerB" }
    ]);
  });

  it("a single task produces no pause at all", () => {
    const { phases } = buildPlanFromTasks([task("a", 1, 1000)], 500);
    expect(phases).toHaveLength(1);
  });

  it("an empty task list produces an empty plan", () => {
    const { phases, answers } = buildPlanFromTasks([], 500);
    expect(phases).toEqual([]);
    expect(answers).toEqual([]);
  });
});

describe("totalPlanDurationMs", () => {
  it("sums every phase's duration, task and pause alike", () => {
    const tasks = [task("a", 1, 1000), task("b", 2, 1500)];
    const { phases } = buildPlanFromTasks(tasks, 500);
    expect(totalPlanDurationMs(phases)).toBe(1000 + 500 + 1500);
  });
});

describe("tasksPerInterval", () => {
  it("divides the round length by the task length", () => {
    expect(tasksPerInterval({ intervalDurationSeconds: 60, intervalCount: 1, taskDurationSeconds: 3, restDurationSeconds: 0 })).toBe(20);
  });

  it("floors a non-whole division", () => {
    expect(tasksPerInterval({ intervalDurationSeconds: 10, intervalCount: 1, taskDurationSeconds: 3, restDurationSeconds: 0 })).toBe(3);
  });

  it("never returns less than 1, even for a round shorter than one task", () => {
    expect(tasksPerInterval({ intervalDurationSeconds: 2, intervalCount: 1, taskDurationSeconds: 5, restDurationSeconds: 0 })).toBe(1);
  });
});

describe("generateIntervalTasks", () => {
  const config: IntervalConfig = { intervalDurationSeconds: 10, intervalCount: 3, taskDurationSeconds: 5, restDurationSeconds: 15 };

  it("produces intervalCount * tasksPerInterval tasks total", () => {
    let n = 0;
    const tasks = generateIntervalTasks(config, () => ({ content: n, correctAnswer: n++ }));
    expect(tasks).toHaveLength(3 * 2); // 10s / 5s = 2 tasks per round, 3 rounds
  });

  it("flags only the last task of each round as roundEnd", () => {
    const tasks = generateIntervalTasks(config, () => ({ content: null, correctAnswer: null }));
    expect(tasks.map((t) => t.roundEnd)).toEqual([false, true, false, true, false, true]);
  });

  it("stamps every task with the configured task duration", () => {
    const tasks = generateIntervalTasks(config, () => ({ content: null, correctAnswer: null }));
    tasks.forEach((t) => expect(t.durationMs).toBe(5000));
  });

  it("calls makeTask once per generated task, in order", () => {
    const seen: number[] = [];
    let n = 0;
    generateIntervalTasks(config, () => {
      seen.push(n);
      return { content: n, correctAnswer: n++ };
    });
    expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("buildIntervalPlanFromTasks", () => {
  it("inserts no gap between tasks within a round", () => {
    const tasks = [task("a", 1, 1000, false), task("b", 2, 1000, true), task("c", 3, 1000, false)];
    const { phases } = buildIntervalPlanFromTasks(tasks, 500);
    expect(phases.map((p) => p.type)).toEqual(["task", "task", "pause", "task"]);
  });

  it("never inserts a rest after the final task even if it's flagged roundEnd", () => {
    const tasks = [task("a", 1, 1000, false), task("b", 2, 1000, true)];
    const { phases } = buildIntervalPlanFromTasks(tasks, 500);
    expect(phases.map((p) => p.type)).toEqual(["task", "task"]);
  });

  it("omits the rest phase when restDurationMs is 0, even at a round boundary", () => {
    const tasks = [task("a", 1, 1000, true), task("b", 2, 1000, false)];
    const { phases } = buildIntervalPlanFromTasks(tasks, 0);
    expect(phases.map((p) => p.type)).toEqual(["task", "task"]);
  });

  it("answers align by phase index, same as buildPlanFromTasks", () => {
    const tasks = [task("a", "answerA", 1000, true), task("b", "answerB", 1000, false)];
    const { phases, answers } = buildIntervalPlanFromTasks(tasks, 300);
    const taskPhases = phases.filter((p) => p.type === "task");
    expect(answers).toEqual([
      { index: taskPhases[0].index, correctAnswer: "answerA" },
      { index: taskPhases[1].index, correctAnswer: "answerB" }
    ]);
  });
});
