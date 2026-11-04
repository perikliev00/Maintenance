
import targeted from './stryker.config.mjs';

export default {
  ...targeted,
  tap: {
    ...targeted.tap,
    // Same file set as `npm run test:all`: most controller/route/DB behaviour is only
    // exercised by `tests/**` (scenario, lifecycle, HTTP suites), not by `src/**`.
    testFiles: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    nodeArgs: [
      '--test-concurrency=1',
      '--test-reporter=tap',
      '--import', './tests/registerP1TestEnv.mjs',
      '--import', 'tsx',
    ],
  },
  mutate: [
    'src/**/*.ts',
    'src/**/*.tsx',
    '!src/**/*.test.ts',
    '!src/**/*.test.tsx',
    '!src/**/*.d.ts',
  ],
  // DB-backed test files share one isolated test database; avoid cross-mutant
  // fixture interference while keeping each file serial as well.
  concurrency: 1,
  // Exploratory scope: report bands only, never blocking (full-scope baseline is unknown
  // and far below the targeted scope). The targeted configs own the `break` gate.
  thresholds: { high: 80, low: 60, break: null },
  incremental: true,
  incrementalFile: 'reports/stryker-full-incremental.json',
  htmlReporter: { fileName: 'reports/stryker-full.html' },
  jsonReporter: { fileName: 'reports/stryker-full.json' },
};


