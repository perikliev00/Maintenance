
import targeted from './stryker.config.mjs';

export default {
  ...targeted,
  tap: {
    ...targeted.tap,
    testFiles: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    nodeArgs: [
      '--test-concurrency=1',
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
  incremental: true,
  incrementalFile: 'reports/stryker-full-incremental.json',
  htmlReporter: { fileName: 'reports/stryker-full.html' },
  jsonReporter: { fileName: 'reports/stryker-full.json' },
};


