# Dev-dependency OSV findings: glob / minimatch / deepmerge (TEST-11)

Date: 2026-11-03. Scope: `api/package-lock.json`, `web/package-lock.json`, `e2e/package-lock.json`.
Method: lockfile inspection, `npm audit` (read-only), and the OSV API (`api.osv.dev/v1/query`, per
package@version). Outcome: **no safe, in-range fix exists; nothing was force-updated or ignored.**
All affected packages are build/test tooling (`devDependencies` or their transitive tools); none is
in the API runtime image (`api/Dockerfile` runs `npm prune --omit=dev`) or executed by the
production web container (static files served by Caddy).

## Findings

| Advisory | Package@version in lockfile | Severity (OSV) | Fixed in | Where (path) |
| --- | --- | --- | --- | --- |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) glob AbortSignal cancellation bypass | `glob@13.0.6` (api, web); `glob@11.1.0` (web) | Moderate | 14.0.2 | api/web: `@stryker-mutator/tap-runner@10.0.0 -> glob ~13.0.0`; web only: `vite-plugin-pwa -> workbox-build@7.4.1 -> glob ^11.0.1`; `c8 -> test-exclude@8 -> glob ^13.0.6` (added by TEST-09, same version) |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) minimatch globparts DoS | `minimatch@10.2.6` (api, web); `minimatch@5.1.9` (web) | Moderate | 11.0.1 | `@stryker-mutator/core@10.0.0 -> minimatch ~10.2.4`; `glob@13/11 -> minimatch ^10`; web only (`minimatch@5.1.9`): `vite-plugin-pwa -> workbox-build -> @trickfilm400/rollup-plugin-off-main-thread -> ejs -> jake -> filelist@1.0.6 -> minimatch ^5`; `c8 -> test-exclude@8 -> minimatch ^10.2.2` |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) deepmerge `mergeObject()` prototype poisoning | `deepmerge@4.3.1` (web) | Low | **no fixed version** | `vite-plugin-pwa -> workbox-build@7.4.1 -> @rollup/plugin-node-resolve@16.0.3 -> deepmerge ^4.2.2` |
| (none) | `deepmerge-ts@8.0.2` (api) | - | - | `@prisma/config` pin; already overridden to `^8.0.2` in `api/package.json`; OSV reports no advisory |
| (none) | `brace-expansion@5.0.12 / 2.1.7`, e2e lockfile | - | - | no `glob`/`minimatch`/`deepmerge` in `e2e`; `npm audit` reports 0 vulnerabilities |

## Why nothing was updated

- **Parent updates were evaluated and do not help.** Latest published parents: `@stryker-mutator/core`
  and `tap-runner` 10.1.1 (installed 10.0.0) still depend on `minimatch ~10.2.4` / `glob ~13.0.0`;
  `vite-plugin-pwa` 2.0.0 (installed ^1.3.0) and `workbox-build` 7.4.1 (latest) still pin
  `glob ^11` and `@rollup/plugin-node-resolve ^16.0.3 -> deepmerge ^4`; `deepmerge` itself has no
  patched release (4.3.1 is latest). The fixed lines (`glob >= 14.0.2`, `minimatch >= 11.0.1`) are
  major-version jumps outside every parent's declared range.
- **`npm audit fix --force` was not used.** For web it proposes installing `vite-plugin-pwa@1.1.0`
  (a *downgrade* of the production PWA build plugin) to shed the whole workbox chain, which is a
  breaking change to shipped build output for dev-tool advisories.
- **No `overrides` forcing `glob@14` / `minimatch@11`.** That would run Stryker, c8's
  `test-exclude` and Workbox against majors they were not released with. For `workbox-build` it
  would change how the production precache manifest is generated. The risk/benefit is poor for
  advisories reachable only with attacker-controlled glob patterns or an aborted `glob()` call in
  trusted tooling run on our own source tree.
- **No blanket ignore** (`osv-scanner.toml` / `--audit-level` suppression) was added. If the OSV CI
  gate (`osv-scanner` PR + main jobs in `.github/workflows/ci.yml`) must be green before upstream
  fixes exist, add *per-advisory* entries (the three IDs above) with an `ignoreUntil` date no more
  than 90 days out and a link to this page, never package-wide ignores.

## Reachability / risk notes

- Stryker (`minimatch`, `glob`) runs only in the scheduled mutation workflow and local mutation
  runs, on repository-controlled patterns. c8 (`test-exclude` -> `glob`, `minimatch`) runs only for
  local/CI coverage commands, on the repository's own `.c8rc.json` patterns.
- Workbox (`glob`, `deepmerge`) runs at `vite build` time with the globs from `vite.config.ts`
  (`**/*.{js,css,html,svg,png,ico,woff2}`) and our own plugin options; the output is static files.
  The `deepmerge` issue needs attacker-controlled input merged at build time. Production images
  contain only the built `dist/` served by Caddy.
- Adding `c8` (TEST-09) introduced **no new vulnerable package versions** (it reuses `glob@13.0.6`
  and `minimatch@10.2.6`) but `npm audit` now counts `c8`/`test-exclude` as additional dependents
  (api 5 -> 7, web 13 -> 15 reported "vulnerabilities" - same three advisories, more paths).

## Re-check and exit criteria

Re-run quarterly or when Dependabot (`.github/dependabot.yml`, weekly for api/web/e2e) opens a PR for:

1. `@stryker-mutator/core`, `@stryker-mutator/tap-runner`, `@stryker-mutator/typescript-checker`:
   accept when the resolved `minimatch >= 11.0.1` and `glob >= 14.0.2`; verify with
   `npm run test:mutation` in `api` and `web` (scores must stay above `thresholds.break`).
2. `workbox-build` / `vite-plugin-pwa`: accept when `glob >= 14.0.2` and `@rollup/plugin-node-resolve`
   no longer resolves `deepmerge@4`; verify `cd web && npm run build` and compare `dist/sw.js`
   precache entries before/after.
3. `c8`/`test-exclude`: accept when it depends on `glob >= 14.0.2` and `minimatch >= 11.0.1`.

Quick checks: `npm ls glob minimatch deepmerge` and `npm audit` in `api`, `web`, `e2e`.
