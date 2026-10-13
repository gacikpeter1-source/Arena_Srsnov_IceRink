import { CognitiveGameGenerator, GeneratedTask } from "./types";
import { IntervalConfig, generateIntervalTasks } from "./engine";

export const CIRCLE_COUNTING_GAME_ID = "circleCounting";

// A small fixed palette, picked by id (not a free color picker) so the
// server and the frontend renderer (src/cognitiveTraining/games/
// circleCounting/index.tsx) always agree on what each id actually looks
// like — the server only ever needs the id, the hex value is purely a
// rendering concern and so only lives on the frontend's own copy
// (CLAUDE.md's usual "functions/ can't import across the src/ boundary,
// so shared constants get a standalone copy where needed" pattern).
export const CIRCLE_COLOR_IDS = ["red", "green", "blue", "yellow", "orange", "white"] as const;
export type CircleColorId = (typeof CIRCLE_COLOR_IDS)[number];

export interface CircleCountingConfig extends IntervalConfig {
  minCircles: number;
  maxCircles: number;
  colors: CircleColorId[];
  targetColor: CircleColorId;
}

export interface CircleItem {
  x: number; // 0-100, percentage position within the TV display area
  y: number; // 0-100
  size: number; // relative size unit, interpreted by the frontend renderer
  color: CircleColorId;
}

export interface CircleCountingContent {
  circles: CircleItem[];
  targetColor: CircleColorId;
}

function randomInt(min: number, max: number, rng: () => number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export const circleCountingGenerator: CognitiveGameGenerator<CircleCountingConfig> = {
  id: CIRCLE_COUNTING_GAME_ID,
  generate(config, rng): GeneratedTask[] {
    // A config with no colors selected (or a target color not actually
    // among them) has nothing sensible to draw/count — fall back to a
    // single-color board of the target color alone rather than crashing,
    // same "degrade gracefully instead of throwing on a bad config"
    // stance mathProblem's own empty-operations fallback already takes.
    const colors: CircleColorId[] = config.colors && config.colors.length > 0 ? config.colors : [config.targetColor ?? "green"];
    const targetColor: CircleColorId = colors.includes(config.targetColor) ? config.targetColor : colors[0];
    const minCircles = Math.max(1, config.minCircles);
    const maxCircles = Math.max(minCircles, config.maxCircles);

    return generateIntervalTasks(config, () => {
      const count = randomInt(minCircles, maxCircles, rng);
      const circles: CircleItem[] = [];
      for (let i = 0; i < count; i++) {
        circles.push({
          x: randomInt(4, 96, rng),
          y: randomInt(4, 96, rng),
          size: randomInt(8, 16, rng),
          color: colors[randomInt(0, colors.length - 1, rng)]
        });
      }
      const correctAnswer = circles.filter((c) => c.color === targetColor).length;
      const content: CircleCountingContent = { circles, targetColor };
      return { content, correctAnswer };
    });
  }
};
