import { describe, it, expect } from "vitest";
import { buildPlanFromTasks, totalPlanDurationMs } from "./engine";
import { GeneratedTask } from "./types";

function task(content: unknown, correctAnswer: unknown, durationMs: number): GeneratedTask {
  return { content, correctAnswer, durationMs };
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
