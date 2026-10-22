
import targeted from './stryker.config.mjs';

export default {
  ...targeted,
  tap: { ...targeted.tap, testFiles: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
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
};


