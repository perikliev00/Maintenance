

export default {
  testRunner: 'tap',
  tap: {
    testFiles: [
      'src/services/attendanceRules.test.ts',
      'src/services/readiness.test.ts',
      'src/services/dataScope/where.test.ts',
      'src/services/roleGrants/normalize.test.ts',
      'src/services/cleaning/deriveServiceType.test.ts',
    ],
    // Node >= 23 prints the spec reporter even when piped; tap-runner parses TAP only.
    nodeArgs: ['--test-reporter=tap', '--import', 'tsx'],
    forceBail: true,
  },
  mutate: [
    'src/services/attendanceRules.ts',
    'src/services/readiness.ts',
    'src/services/dataScope/where.ts',
    'src/services/roleGrants/normalize.ts',
    'src/services/cleaning/deriveServiceType.ts',
  ],
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  typescriptChecker: { prioritizePerformanceOverAccuracy: true },
  coverageAnalysis: 'perTest',
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  concurrency: 4,
  timeoutMS: 20000,
  timeoutFactor: 2,
  reporters: ['clear-text', 'html', 'json', 'progress'],
  htmlReporter: { fileName: 'reports/stryker.html' },
  jsonReporter: { fileName: 'reports/stryker.json' },
  // Blocking gate for the targeted critical-logic scope (see docs/testing/MUTATION_TESTING.md).
  // Measured baseline 98.66 % (295 killed / 4 survived, 2026-11-03);
  // break = baseline - ~4 points (about 12 extra undetected mutants).
  thresholds: { high: 98, low: 96, break: 95 },
};





