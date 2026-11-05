# Authorization guarantees

Authoritative contract for RoleGrants, sessions, roles, and data scope across
one or more API processes sharing the same PostgreSQL database.

## When a permission change takes effect

| Change | Visibility |
| --- | --- |
| `replaceRoleGrants` (permissions matrix PUT) | Immediately after commit on **every** API instance. `canPerform` re-reads a cheap `RoleGrantRevision` stamp before trusting the in-process cache. |
| Local `invalidateGrantCache()` | Immediate in the calling process; other processes rely on the revision stamp, not on in-memory invalidation. |
| User `role` / `isActive` update | Immediate on the next authenticated request. `authenticateToken` loads role and activity from the DB (JWT claims are not authoritative). |
| AuthSession revoke / user deactivate | Immediate on the next request. `assertSessionActive` is DB-backed every time. |
| Supervisor sector / location membership | Next scoped query / mutation that resolves `DataScope` from the DB. Membership writers take Location/Sector row locks; see live-access lock protocol. |

The in-process grant matrix still uses a **5 second TTL** as a performance ceiling
when the revision stamp is unchanged. The stamp check runs on every
`getGrantMap` / `canPerform` path, so cross-instance revoke does **not** wait for TTL.

## In-flight operations

Middleware (`requireAuth` / `requireAction`) evaluates identity and grants at
**request start**.

- A request that already passed `requireAction` is not automatically aborted if
  grants are revoked while the handler runs.
- Critical **assignment / start** mutations re-check assignee eligibility under
  PostgreSQL `User` row locks (`FOR SHARE`) inside the write transaction, so a
  concurrent deactivate / role change cannot commit a stale eligibility read.
- Writers that change live access take `User FOR UPDATE` (stable id order)
  before mutating sessions, roles, or grants that affect SSE delivery.

Contract summary: **new requests** see the post-revoke world; **already
authorized in-flight handlers** may finish unless a domain transaction
explicitly re-validates under row locks.

## Multiple API instances

- RoleGrant matrix: safe across instances via DB revision stamp (no Redis).
- Session / role / active flag: safe (DB read per request).
- SSE fan-out, rate limits, and some settings caches remain **single-replica**
  concerns — see `docs/operations/deploy.md`. Scaling replicas still requires
  those to be shared; grant authorization alone is not the blocker for
  `canPerform` correctness.

## Remaining limitations

- In-flight handlers that do not re-check grants inside their transaction can
  complete after a concurrent revoke of the action key.
- `restoreRoleGrants` in tests bumps `RoleGrantRevision` so stamp-gated caches
  stay coherent; ad-hoc SQL edits to `RoleGrant` without bumping revisions can
  leave other processes serving TTL-cached rows until expiry or process restart.
- Data-scope mutations mid-flight are serialized by Location/Sector locks, not
  by the RoleGrant cache.
