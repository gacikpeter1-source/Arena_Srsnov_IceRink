import { CognitivePhase, GeneratedTask } from "./types";

// Shared by every game, so an individual generator only ever has to worry
// about producing its own tasks (content/answer/duration) — interleaving
// a pause between them is one piece of logic, not something each new game
// has to reimplement. No pause is inserted after the last task.
export function buildPlanFromTasks(
  tasks: GeneratedTask[],
  pauseDurationMs: number
): { phases: CognitivePhase[]; answers: { index: number; correctAnswer: unknown }[] } {
  const phases: CognitivePhase[] = [];
  const answers: { index: number; correctAnswer: unknown }[] = [];

  tasks.forEach((task, i) => {
    const index = phases.length;
    phases.push({ index, type: "task", durationMs: task.durationMs, content: task.content });
    answers.push({ index, correctAnswer: task.correctAnswer });

    const isLast = i === tasks.length - 1;
    if (!isLast && pauseDurationMs > 0) {
      phases.push({ index: phases.length, type: "pause", durationMs: pauseDurationMs, content: null });
    }
  });

  return { phases, answers };
}

// The shared config shape for a "round"/"interval" style game (math
// problems, formulas, circle counting, ...): instead of the trainer
// typing a flat task count, they think in terms of "N rounds of M
// seconds each" (matching the physical exercise structure — e.g. 8
// rounds of 1 minute), with tasks shown back-to-back with NO gap within
// a round, and one rest only at each round boundary. Deliberately kept
// separate from randomNumber's own taskCount/pauseDurationSeconds shape
// (that demo game is untouched) rather than replacing it everywhere.
export interface IntervalConfig {
  intervalDurationSeconds: number
  intervalCount: number
  taskDurationSeconds: number
  restDurationSeconds: number
}

// How many whole tasks fit in one round, given how long each task is
// shown. At least 1, even if the trainer's own numbers would compute to
// 0 (e.g. a very short round with a longer task duration) — a round
// should never silently generate zero tasks.
export function tasksPerInterval(config: IntervalConfig): number {
  const taskDurationMs = Math.max(1, config.taskDurationSeconds) * 1000;
  const intervalDurationMs = Math.max(1, config.intervalDurationSeconds) * 1000;
  return Math.max(1, Math.floor(intervalDurationMs / taskDurationMs));
}

// Builds a full round-based task list for an IntervalConfig-shaped game:
// loops intervalCount rounds, tasksPerInterval(config) tasks each, calling
// makeTask() for each individual task's own content/correctAnswer (every
// game's own generation logic) and flagging the last task of every round
// so buildIntervalPlanFromTasks knows where a rest belongs.
export function generateIntervalTasks<C extends IntervalConfig>(
  config: C,
  makeTask: () => { content: unknown; correctAnswer: unknown }
): GeneratedTask[] {
  const perRound = tasksPerInterval(config);
  const rounds = Math.max(1, config.intervalCount);
  const taskDurationMs = Math.max(1, config.taskDurationSeconds) * 1000;
  const tasks: GeneratedTask[] = [];

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < perRound; i++) {
      const { content, correctAnswer } = makeTask();
      tasks.push({ content, correctAnswer, durationMs: taskDurationMs, roundEnd: i === perRound - 1 });
    }
  }

  return tasks;
}

// The round-aware counterpart to buildPlanFromTasks above: no gap between
// tasks within the same round (back-to-back, matching "bez odratávania"
// — no countdown/pause screen interrupting a round), one rest phase only
// where a task is flagged roundEnd (and never after the very last task
// overall, same "no trailing pause" rule buildPlanFromTasks already
// follows).
export function buildIntervalPlanFromTasks(
  tasks: GeneratedTask[],
  restDurationMs: number
): { phases: CognitivePhase[]; answers: { index: number; correctAnswer: unknown }[] } {
  const phases: CognitivePhase[] = [];
  const answers: { index: number; correctAnswer: unknown }[] = [];

  tasks.forEach((task, i) => {
    const index = phases.length;
    phases.push({ index, type: "task", durationMs: task.durationMs, content: task.content });
    answers.push({ index, correctAnswer: task.correctAnswer });

    const isLast = i === tasks.length - 1;
    if (!isLast && task.roundEnd && restDurationMs > 0) {
      phases.push({ index: phases.length, type: "pause", durationMs: restDurationMs, content: null });
    }
  });

  return { phases, answers };
}

export function totalPlanDurationMs(phases: CognitivePhase[]): number {
  return phases.reduce((sum, p) => sum + p.durationMs, 0);
}
