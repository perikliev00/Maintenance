# PWA and mobile test scope (TEST-12)

This page states what the automated tests do and do not prove about the installable/offline web app
and narrow-screen use. It is a scope statement, not a coverage claim. No new test was added: a
production-build scenario is feasible but not clearly required by a defect or a documented
requirement (see "Decision").

## Product behaviour that matters

- `web/vite.config.ts` uses `vite-plugin-pwa` (`registerType: "autoUpdate"`): web manifest
  (`display: standalone`, `start_url: "/"`, 192/512 PNG + SVG icons) and a Workbox service worker
  (`sw.js`) that **precaches static assets only** (`js, css, html, svg, png, ico, woff2`) and uses a
  navigation fallback to `/index.html` that **denies `/api/*`**. There is deliberately **no runtime
  caching of `/api`**: Cache Storage is shared across users of a device, so private data is never
  stored there.
- `web/src/main.tsx` registers the SW **only in production builds** (`import.meta.env.PROD`),
  checks for updates hourly, and drains the IndexedDB outbox when the SW reports `offlineReady`. In
  development it unregisters any leftover SW and `workbox-*`/`api-get` caches so live/SSE requests
  are never stuck behind a stale worker.
- Offline *data* (queued commands, drafts, per-account partitions, purge on account switch) lives in
  IndexedDB, not in the SW. README lists My Work as a mobile/PWA surface.
- The production edge (`web/Caddyfile`) serves `/`, `/index.html`, `/sw.js`, `/workbox-*.js` and
  `/manifest.webmanifest` with `no-cache, no-store`, fingerprinted assets as `immutable`, and a CSP
  with `worker-src 'self'; manifest-src 'self'`.

## What is covered today

| Concern | Evidence | Nature |
| --- | --- | --- |
| Offline queue, retry, conflict, drain, orphan recovery, transport, connection state | `web/src/offline/*.test.ts` (9 files incl. `scenarios.test.ts`) | Node unit tests of pure logic/state machines; targeted mutation testing on `conflict.ts`, `connState.ts` |
| Offline UX against controlled transport/storage faults (failed-row retry/dismiss, account switch, quota) | `e2e/tests/scenarios/offline.spec.ts`, `auth-recovery.spec.ts` via `web/tests/browserHarness.tsx` | Browser **integration** with faked fetch/`navigator.onLine`/storage; no service worker |
| Outbox behaviour across an account switch mid-drain | `e2e/tests/mid-drain-switch.spec.ts` | Playwright against the dev stack |
| One narrow-viewport layout check (390x844): Repairs pagination controls stay usable; sidebar off-canvas helper `openNav` | `e2e/tests/repairs-pagination.spec.ts`, `e2e/tests/helpers/nav.ts` | Playwright, Desktop Chrome with a resized viewport |
| Responsive CSS exists (`@media` in shell, my-work, repairs, analytics, settings, modals) | source only | **Not asserted** except the single case above |
| Build emits manifest + SW with the intended denylist and no `/api` runtime route | manually inspected `web/dist` (`sw.js`: one `registerRoute` for the navigation route with a denylist; `manifest.webmanifest` fields as configured); CI runs `npm run build` | Build success only; contents are not asserted |
| Edge routing and security headers in containers | CI "Container verification" job | Container smoke; does not load the SPA in a browser or register the SW |

## What is NOT covered

- **Service worker lifecycle in a real browser**: registration, activation, `autoUpdate` of a new
  precache manifest, hourly update check, `onOfflineReady` -> `drainQueue()` wiring. All Playwright
  configs run against the Vite **dev** server (`vite.config.ts` / `vite.scenarios.config.ts`), where
  `import.meta.env.PROD` is false, so the SW is never registered by any test.
- **Offline app shell**: loading/reloading the app with the network off from the precache, and the
  navigation fallback (`/index.html`, `/api/*` excluded).
- **Installability**: manifest validity/Lighthouse-style checks, icon sizes, `display: standalone`
  launch, "Add to Home Screen" on iOS/Android, maskable icon rendering.
- **Cache hygiene**: that `/api` responses are never put in Cache Storage by the production worker
  (currently guaranteed by configuration and a manual inspection, not by a test).
- **Real mobile behaviour**: physical-device/emulator touch input, soft keyboard, safe areas,
  orientation changes, background/foreground resume of SSE and the outbox, throttled/lossy
  networks, Safari/WebKit and Firefox. Only Desktop Chrome (Chromium) runs, with one 390x844 case.
- **Edge cache headers for `sw.js`/manifest** in a running Caddy (headers are configured, not
  tested), and the SW update flow behind the production proxy (docs/operations/deploy.md lists a
  manual staging check: "asset/service-worker update checks").
- Coverage numbers: web Node coverage ([`COVERAGE.md`](./COVERAGE.md)) does not include `main.tsx`
  (0 %) or any browser path; it is not evidence for PWA behaviour.

## Decision

A targeted production-build scenario would: `vite build`, serve `dist` (plus an `/api` proxy to the
isolated API), run Chromium with service workers enabled, and assert (1) manifest fields and icon
reachability, (2) SW activation, (3) the shell loads offline after one online visit, (4) no
`/api/*` entries in Cache Storage after an authenticated session, (5) `offlineReady` drains a
seeded outbox. It is **feasible** (Playwright can serve `localhost` as a secure context) but needs a
second server topology in `playwright.scenarios.config.ts`, cookie/CSRF handling behind a proxy and
careful teardown of worker registrations, i.e. a new flaky-prone suite. There is no failing behaviour
or written requirement driving it, and the configuration is small and reviewed (denylist, no runtime
cache, update policy are explicit in `vite.config.ts`/`main.tsx`). Therefore the gap is **documented
rather than filled**.

Recommended next step if installability/offline-shell becomes a release requirement: add the
production-build scenario above as a separate opt-in Playwright project (not part of root `npm test`),
and a cheap post-build node:test that asserts `dist/manifest.webmanifest` fields and that `dist/sw.js`
contains the `/api` navigation denylist and no runtime route. Until then, treat PWA/offline-shell and
mobile device behaviour as **manually verified at staging** (see `docs/operations/deploy.md`), and
describe the narrow-viewport automation as a single regression check, not mobile coverage.
