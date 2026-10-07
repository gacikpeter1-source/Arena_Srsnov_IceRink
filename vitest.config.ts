import { defineConfig } from 'vitest/config'
import path from 'path'

// Separate from vite.config.ts (rather than adding a `test` key there) so
// the PWA/build pipeline's own config stays untouched — this only needs
// to be loadable by vitest itself. Covers both src/ (frontend, e.g. the
// pure phase-computation engine) and functions/src/ (the cognitive-game
// generators) — the latter is a separate TypeScript project from src/ (see
// CLAUDE.md) for *building*/deploying, but vitest doesn't care about that
// project boundary, only about executable, dependency-free TS files.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'functions/src/**/*.test.ts']
  }
})
