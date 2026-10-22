

export default {
  testRunner: 'tap',
  tap: {
    testFiles: [
      'src/api/sessionPolicy.test.ts',
      'src/offline/connState.test.ts',
      'src/offline/conflict.test.ts',
      'src/pages/locations/permissions.test.ts',
    ],
    nodeArgs: ['--import', 'tsx'],
    forceBail: true,
  },
  mutate: [
    'src/api/sessionPolicy.ts',
    'src/offline/connState.ts',
    'src/offline/conflict.ts',
    'src/pages/locations/permissions.ts',
  ],
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  typescriptChecker: { prioritizePerformanceOverAccuracy: true },
  coverageAnalysis: 'perTest',
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  concurrency: 6,
  timeoutMS: 20000,
  timeoutFactor: 2,
  reporters: ['clear-text', 'html', 'json', 'progress'],
  htmlReporter: { fileName: 'reports/stryker.html' },
  jsonReporter: { fileName: 'reports/stryker.json' },
  thresholds: { high: 80, low: 60, break: null },
};



