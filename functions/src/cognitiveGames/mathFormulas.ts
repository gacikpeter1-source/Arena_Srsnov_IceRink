import { CognitiveGameGenerator, GeneratedTask } from "./types";
import { IntervalConfig, generateIntervalTasks } from "./engine";

export const MATH_FORMULAS_GAME_ID = "mathFormulas";

// A fixed, built-in bank of common geometry formulas — per explicit
// product direction, not a trainer-editable list for this pass. `key` is
// the stable id both this file and the matching frontend module
// (src/cognitiveTraining/games/mathFormulas/index.tsx) use to look up the
// formula's own translated name — the formula text itself (plain unicode
// math symbols) is shown as-is, the same in every language, so only the
// *name* needs a translation key.
export interface MathFormulaEntry {
  key: string;
  formula: string;
}

export const MATH_FORMULAS: MathFormulaEntry[] = [
  { key: "circleCircumference", formula: "2 × π × r" },
  { key: "circleArea", formula: "π × r²" },
  { key: "squareArea", formula: "a²" },
  { key: "squarePerimeter", formula: "4 × a" },
  { key: "rectangleArea", formula: "a × b" },
  { key: "rectanglePerimeter", formula: "2 × (a + b)" },
  { key: "triangleArea", formula: "(a × v) ÷ 2" },
  { key: "cubeVolume", formula: "a³" },
  { key: "cylinderVolume", formula: "π × r² × v" },
  { key: "sphereVolume", formula: "(4 ÷ 3) × π × r³" }
];

export interface MathFormulasConfig extends IntervalConfig {}

export interface MathFormulasContent {
  key: string;
  formula: string;
}

function randomInt(min: number, max: number, rng: () => number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export const mathFormulasGenerator: CognitiveGameGenerator<MathFormulasConfig> = {
  id: MATH_FORMULAS_GAME_ID,
  generate(config, rng): GeneratedTask[] {
    // Avoids showing the exact same formula twice in a row (a plain
    // uniform random pick easily repeats on a small bank) — otherwise
    // unconstrained, still a pure random draw each task.
    let lastIndex = -1;
    return generateIntervalTasks(config, () => {
      let index = randomInt(0, MATH_FORMULAS.length - 1, rng);
      if (MATH_FORMULAS.length > 1) {
        while (index === lastIndex) {
          index = randomInt(0, MATH_FORMULAS.length - 1, rng);
        }
      }
      lastIndex = index;
      const entry = MATH_FORMULAS[index];
      const content: MathFormulasContent = { key: entry.key, formula: entry.formula };
      return { content, correctAnswer: entry.key };
    });
  }
};
