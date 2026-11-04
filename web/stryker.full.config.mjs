
import { readdirSync } from 'node:fs';
import targeted from './stryker.config.mjs';

// The tap runner has no negative globs, so list the test files explicitly.
// These tests assert on the *source text* of production files (readFileSync); Stryker's
// instrumentation rewrites that text, so they fail the dry run (they pass under `npm test`).
const SOURCE_TEXT_TESTS = new Set([
  'src/pages/liveBoardController.test.ts',
  'src/hooks/useLiveRefresh.events.test.ts',
]);
const testFiles = readdirSync('src', { recursive: true })
  .map((f) => `src/${String(f).replaceAll('\\', '/')}`)
  .filter((f) => /\.test\.tsx?$/.test(f) && !SOURCE_TEXT_TESTS.has(f))
  .sort();

export default {
  ...targeted,
  tap: { ...targeted.tap, testFiles },
  mutate: [
    'src/**/*.ts',
    'src/**/*.tsx',
    '!src/**/*.test.ts',
    '!src/**/*.test.tsx',
    '!src/**/*.d.ts',
  ],
  incremental: true,
  incrementalFile: 'reports/stryker-full-incremental.json',
  htmlReporter: { fileName: 'reports/stryker-full.html' },
  jsonReporter: { fileName: 'reports/stryker-full.json' },
  // Exploratory scope: report bands only, never blocking. Most React `.tsx` files have no
  // Node unit tests (browser behaviour is covered by Playwright, which is not mutated),
  // so a full-scope score is not comparable to the targeted gate.
  thresholds: { high: 80, low: 60, break: null },
};


