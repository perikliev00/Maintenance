# deepmerge 4.3.2 (security patch)

Vendored from `deepmerge@4.3.1` with the GHSA-gcqx-w48m-w2h4 / CVE-2026-93753 fix:

- Reject `__proto__`, `constructor`, and `prototype` keys by name in both merge loops.
- Assign via `Object.defineProperty` so the `__proto__` accessor is never invoked.

Upstream has not published a fixed release (`last_affected` is still 4.3.1). This package is versioned `4.3.2` so OSV treats it as outside the affected range, and is wired through `web/package.json` overrides (`file:vendor/deepmerge`).

Remove this vendor tree once upstream ships a patched release and `vite-plugin-pwa` / `workbox-build` pick it up.
