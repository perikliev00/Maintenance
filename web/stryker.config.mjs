import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `src/api/capabilities.ts` imports the shared catalog by a relative path that leaves
// the web package (`../../../api/src/contracts/permissionsCatalog`). Stryker runs tests
// in `web/.stryker-tmp/sandbox-*`, where that path resolves to `web/.stryker-tmp/api/...`.
// Stage the (dependency-free) contracts directory there so the dry run can import it.
const webRoot = dirname(fileURLToPath(import.meta.url));
const stagedContracts = resolve(webRoot, '.stryker-tmp/api/src/contracts');
mkdirSync(stagedContracts, { recursive: true });
cpSync(resolve(webRoot, '../api/src/contracts'), stagedContracts, { recursive: true });

export default {
  testRunner: 'tap',
  tap: {
    testFiles: [
      'src/api/sessionPolicy.test.ts',
      'src/offline/connState.test.ts',
      'src/offline/conflict.test.ts',
      'src/pages/locations/permissions.test.ts',
    ],
    // Node >= 23 prints the spec reporter even when piped; tap-runner parses TAP only.
    nodeArgs: ['--test-reporter=tap', '--import', 'tsx'],
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
  // Blocking gate for the targeted critical-logic scope (see docs/testing/MUTATION_TESTING.md).
  // Measured baseline 91.88 % (283 killed / 21 survived / 4 no coverage, 2026-11-03);
  // break = baseline - ~4 points (about 12 extra undetected mutants).
  thresholds: { high: 95, low: 90, break: 88 },
};
