import { CognitiveGameGenerator, GeneratedTask } from "./types";

// The demo game this module ships with purely to verify TV/phone sync end
// to end (see CLAUDE.md) — not a real training drill. A player sees a
// random number on the TV; content and correctAnswer are the same value
// (there's nothing to hide here), which is exactly what lets this game
// double as a test of the content/answer split plumbing without needing
// a game where the two genuinely differ.
export interface RandomNumberConfig {
  taskCount: number;
  taskDurationSeconds: number;
  min: number;
  max: number;
}

export const RANDOM_NUMBER_GAME_ID = "randomNumber";

function randomInt(min: number, max: number, rng: () => number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export const randomNumberGenerator: CognitiveGameGenerator<RandomNumberConfig> = {
  id: RANDOM_NUMBER_GAME_ID,
  generate(config, rng): GeneratedTask[] {
    const tasks: GeneratedTask[] = [];
    for (let i = 0; i < config.taskCount; i++) {
      const number = randomInt(config.min, config.max, rng);
      tasks.push({
        content: { number },
        correctAnswer: number,
        durationMs: config.taskDurationSeconds * 1000
      });
    }
    return tasks;
  }
};
