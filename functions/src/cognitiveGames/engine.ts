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

export function totalPlanDurationMs(phases: CognitivePhase[]): number {
  return phases.reduce((sum, p) => sum + p.durationMs, 0);
}
