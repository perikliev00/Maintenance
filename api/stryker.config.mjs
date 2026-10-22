

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
    nodeArgs: ['--import', 'tsx'],
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
  thresholds: { high: 80, low: 60, break: null },
};





