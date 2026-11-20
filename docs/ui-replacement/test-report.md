# Independent interface replacement: test report

Date: 20 November 2026. Branch: `feat/independent-maintenance-experience`.

## Isolation

All database-backed verification uses the repository's P1 preload, which redirects dotenv loads to `api/.env.p1_test` and requires the database name `maintenance_p1_test`. PostgreSQL runs locally in the existing `maintenance-db-1` container on loopback port 5433. No production environment or production data is used. Main browser tests boot their own API on 4000 and Vite on 5173; scenario tests use 4018 and 5185. The main Playwright configuration refuses to reuse existing servers and uses the direct TypeScript import loader so the P1 environment preload remains in the server process.

## Baseline and unit verification

| Check | Result |
| --- | --- |
| `npm run test --prefix web` | PASS: 362 tests, 92 suites |
| `npm run build --prefix web` | PASS |
| `npm run typecheck:tests --prefix web` | PASS |
| `npm run typecheck --prefix e2e` | PASS |
| API jobs.run fixture race (advisory-lock barrier) | PASS (3 targeted tests) |

## Replacement-specific browser coverage

| Suite | Result |
| --- | --- |
| `independent-workspaces.spec.ts` (owner destinations, 7 roles finder, 390/1280, modal Escape ownership) | PASS 11/11 |
| `login.smoke.spec.ts` | PASS |
| `module-toggle-nav.spec.ts` | PASS |
| `housekeeping-modals.spec.ts` | PASS 8/8 |
| `location-actions-by-role.spec.ts` | PASS |
| `my-work-housekeeper-shift.spec.ts` | PASS |
| `my-work-technician-queue.spec.ts` | PASS |
| `readiness-blocking-flow.spec.ts` | PASS |
| `repairs-lifecycle-flow.spec.ts` | PASS |
| `repairs-pagination.spec.ts` | PASS 5/5 |
| `rooms-reassign-modal.spec.ts` | PASS (fixed race: wait for force-override enablement) |

## Cleanup completed after Codex stop

- Removed unused legacy styles under `web/src/styles/`
- Removed unused `BrandMark.tsx` and `hero.png`
- Product icons are the independently drawn `studio-icon.svg` / `studio-192.png` / `studio-512.png`
- Deleted tracked `референция` (Imperial-named domain notes) from the working tree for this branch

## Remaining / out of scope for this report

Full main Playwright inventory (all ~35 files) and scenario suite (~60 tests) were not exhaustively re-run in this continuation session; the suites above cover navigation, roles, housekeeping, repairs lifecycle/pagination, readiness, and reassignment. Automated evidence does not prove every untested interaction, production behavior, or freedom from intellectual-property or contractual risk.

See also: [independent-review.md](./independent-review.md), [experience-spec.md](./experience-spec.md), [functional-spec.md](./functional-spec.md).
