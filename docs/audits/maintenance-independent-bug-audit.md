# Maintenance — Independent Bug & Risk Audit

**Audit date:** 20 October 2026  
**Repository state:** Audited without modifying application code, tests, or the pre-existing uncommitted analytics/refactoring work.

## A. Executive Summary

The implementation has extensive transactional guards, row locks, idempotency keys, scope enforcement, CSRF/session controls, and targeted concurrency tests. The audited lifecycle, readiness, planning, attendance, cards, sector, roster, sync, and browser flows generally behaved as designed.

Three defects were confirmed in the verified scope:

| Severity | Count |
| --- | ---: |
| P0 | 0 |
| P1 | 1 |
| P2 | 2 |

Areas inspected included API routes/controllers/middleware; auth and CSRF; RoleGrant authorization; data scope; cleaning, maintenance-ticket, readiness, daily-plan, attendance, cards, sector, shift, notification, job, and sync services; Prisma schema/migrations; React capability gates and offline queue handling; and the automated test suites.

### Tests executed

- `api`: TypeScript build passed.
- `api`: source test run executed 295 tests: 294 passed and one shared-database permission-matrix test failed in the full parallel invocation. Its targeted isolated invocation passed; it is not a confirmed product defect.
- `web`: production build passed; 80 tests passed.
- `api` lifecycle/integration suites passed for tickets (25), readiness (10), plan (19), attendance (23), cards (22), sectors (22), shifts (13), my-work (10), cleaning sessions (9), cleaning HTTP reassignment (1), and the observed scenario analytics tests (13).
- `e2e`: standard Playwright suite passed (12 tests); scenario Playwright suite passed (52 tests).
- Focused, temporary reproductions were used for AUDIT-001 and AUDIT-003, then removed. AUDIT-001 deterministically produced PostgreSQL `40P01 deadlock detected`; AUDIT-003 returned `forbidden` for the offline path while the equivalent direct path succeeded.

### Areas not conclusively verified

- The full cleaning lifecycle suite cannot complete cleanly: its deterministic start-versus-reassign race exposes AUDIT-001. Two separate lock-holder tests (`T-CLN-15b` and `T-CLN-15d`) also expire their interactive test transaction while deliberately holding a task/ticket lock and then waiting for a conflicting user update. Those two intended revalidation assertions were not treated as separate product defects.
- The audit used the configured local/test PostgreSQL environment. Production deployment configuration, external email/push delivery providers, load characteristics, and browser/device combinations outside the executed Playwright runs were not independently verified.

## B. Confirmed Findings

### AUDIT-001

**Severity:** P1

**Title:** Concurrent cleaning start and reassignment deadlock instead of resolving as a lifecycle conflict.

**Location:**

- `api/src/services/cleaning/sessions.ts:75-77` acquires the `CleaningTask` row lock first.
- `api/src/services/cleaning/sessions.ts:153-156` later takes a shared lock on the starter's `User` through `assertActiveWorkStarter`.
- `api/src/services/cleaning/tasks.ts:228-241` acquires `User` update locks first and then the same `CleaningTask` lock for reassignment.

**Expected behavior:** Concurrent, incompatible lifecycle actions should serialize and leave one valid winner. The loser should receive the existing structured conflict/version/state response, not an unhandled database failure.

**Actual behavior:** A start that has the task lock can wait for the starter's user lock while a reassignment holds that user lock and waits for the task. PostgreSQL detects the cycle and aborts one transaction with `40P01 deadlock detected`. The resulting Prisma `P2010` is not mapped to an application conflict, so the affected HTTP request becomes a 500.

**Root cause:** The two code paths acquire the same resources in opposite order: `CleaningTask → User` for start, and `User → CleaningTask` for reassignment.

**Failure scenario:**

1. Housekeeper A starts an assigned cleaning task while a manager reassigns it to housekeeper B.
2. Start obtains `FOR UPDATE` on the task.
3. Reassign obtains `FOR UPDATE` on the relevant user rows and waits for the task.
4. Start validates the active starter and requests `FOR SHARE` on housekeeper A's user row.
5. PostgreSQL detects the circular wait and aborts one transaction.

**Evidence:** The existing deterministic race test at `api/tests/cleaning/lifecycle.concurrency.test.ts:234-285` consistently fails for the start-first ordering because the rejected result is not an `AppError`. A focused reproduction captured the actual database error: Prisma `P2010`, PostgreSQL code `40P01`, `ERROR: deadlock detected`; the start committed and the reassign request was aborted.

**Verification status:** Reproduced.

**Business impact:** A common operational collision—starting work while dispatch changes the assignee—can fail one core cleaning command with a server error. The data remains transactional, but the user cannot distinguish retryable contention from an outage and an offline client may retain/retry the command incorrectly.

**Recommended fix:** Use one global ordering for lifecycle operations that touch both task and employee access state. For example, have `startCleaningTask` acquire the relevant user lock before the task lock, consistent with reassignment, and re-read/validate task state after both locks. Review adjacent task/session operations for the same ordering rule. Optionally map a remaining serialization/deadlock error to a safe retryable conflict, but do not rely on error mapping instead of a consistent lock order.

**Regression test:** Extend `T-CLN-29` to assert that both ordered races settle as one success plus a structured `conflict`, `invalid_state`, or `version_conflict`, and explicitly fail on Prisma/PostgreSQL deadlock errors. Add an HTTP-level assertion that neither race returns 500.

### AUDIT-002

**Severity:** P2

**Title:** Ticket controls ignore the server-provided action grant matrix.

**Location:**

- `web/src/api/capabilities.ts:221-260` defines legacy role helpers and correctly defines `canPerformAction`, where an explicit `user.actions` array is authoritative.
- `web/src/pages/RepairsPage/index.tsx:90-94`, `web/src/pages/HomePage.tsx:62`, `web/src/pages/ControlPage.tsx:77-79`, `web/src/pages/myWork/MyWorkPage.tsx:71`, and `web/src/pages/locations/permissions.ts:45` directly use the legacy role helpers instead.
- `api/src/controllers/auth.ts:22-55` always includes current `actions` in normal login and `/auth/me` responses.

**Expected behavior:** The React UI should gate ticket report/assign/resolve/close controls from the current `actions` array, matching API `requireAction` authorization and the configurable RoleGrant matrix.

**Actual behavior:** A technician/supervisor/manager/admin with `tickets.resolve` revoked still sees lifecycle controls because `canResolveIssues(user.role)` ignores `user.actions`. Conversely, a role granted `tickets.resolve` outside the legacy hard-coded role list does not receive the controls. The server then correctly accepts or rejects requests based on RoleGrant, producing a visible frontend/backend disagreement.

**Root cause:** The components call legacy role-only helpers even though `canPerformAction` already implements the required authoritative-action behavior.

**Failure scenario:** An administrator revokes `tickets.resolve` from the technician role in the permission matrix. On the next login or `/auth/me` refresh the technician receives `actions: []` (or an array without `tickets.resolve`), but the repairs/my-work controls remain visible. Selecting one sends a request that the server rejects with 403. The inverse occurs when an administrator delegates the action to a role absent from the legacy list.

**Evidence:** `web/src/pages/locations/permissions.test.ts:95-120` explicitly asserts the current contradictory behavior: a technician with `actions: []` has `canResolve === true`. In the same module, `canPerformAction` documents that an explicit empty array is authoritative (`web/src/api/capabilities.ts:247-256`). API authorization is action-based on the ticket routes (`api/src/routes/maintenance/tickets.ts:44-84`).

**Verification status:** Statically demonstrated and covered by the existing client test.

**Business impact:** Configured permissions do not produce the intended user experience. Users can be shown controls that always fail, while delegated users can be prevented from performing permitted ticket work through the UI.

**Recommended fix:** Replace each direct `canResolveIssues`, `canAssignIssues`, and `canCloseIssues` UI gate with `canPerformAction(user, "tickets.resolve" | "tickets.assign" | "tickets.close")`. Retain the role helpers only as the fallback path inside `canPerformAction` for profiles that genuinely lack `actions`.

**Regression test:** For each affected screen/gate, assert both directions: an explicit empty action array hides all related controls for a legacy-eligible role, and an explicit action grants the control to a legacy-ineligible role. Confirm that absent `actions` still uses the compatibility fallback.

### AUDIT-003

**Severity:** P2

**Title:** Offline ticket lifecycle drops the privileged assignee override used by the online API.

**Location:**

- `api/src/controllers/maintenance/tickets.ts:30-40` defines the privileged assignee-bypass roles.
- `api/src/controllers/maintenance/tickets.ts:257-261`, `293-299`, `327-332`, and `364-369` forwards `bypassAssigneeCheck` for direct start/wait/resume/resolve requests.
- `api/src/services/sync/commands/tickets.ts:86-90`, `112-120`, `142-146`, and `168-176` invokes the same domain operations without that flag.

**Expected behavior:** A permitted manager, supervisor, administrator, owner (and a delegated reception role where relevant) should retain the same documented ability to progress an in-scope ticket assigned to another worker when the command is queued offline and later synchronized.

**Actual behavior:** The online endpoint supplies `bypassAssigneeCheck`; the sync handlers do not. A queued lifecycle command by a privileged actor for another employee's ticket reaches the domain service as non-bypass and returns `forbidden: Ticket is assigned to another employee`.

**Root cause:** The privilege calculation exists only in the HTTP controller and is not shared with the offline sync dispatch path.

**Failure scenario:** A manager has `tickets.resolve`, sees a technician's in-scope assigned ticket, and queues Start while disconnected. On reconnect, `/sync/push` processes `ticket.start`; authorization and scope pass, but the domain call lacks the bypass flag and marks the queued command forbidden. The same manager performing the same action online succeeds.

**Evidence:** A focused reproduction created a ticket assigned to a technician. `startMaintenanceTicket(..., bypassAssigneeCheck: true)` succeeded for the manager; `applyCommand` with the manager's otherwise valid `ticket.start` command returned `{ status: "forbidden", message: "Ticket is assigned to another employee" }`. The divergent parameters are visible in the cited call sites.

**Verification status:** Reproduced.

**Business impact:** Privileged dispatch staff cannot reliably progress other workers' tickets offline. The command is retained/marked as a permission failure instead of performing the operation that the same authenticated user is entitled to perform online.

**Recommended fix:** Move `canBypassTicketAssignee` to a shared authorization/domain helper and apply it in both the HTTP controller and all four sync lifecycle handlers. Keep the existing action-grant and data-scope checks unchanged.

**Regression test:** Add sync HTTP tests for a manager/supervisor acting on another employee's assigned ticket through start, wait, resume, and resolve; compare each result and state transition to the direct route. Include a technician negative control to ensure the bypass is not broadened.

## C. Disproved Suspicions

- **Cross-scope reads and writes:** The scope HTTP suite passed its foreign-location/ticket denial, scope-refresh, aggregate-scoping, and counter-isolation cases. Location/ticket services also re-check scope before mutation. No confirmed cross-sector or cross-assignee exposure was found.
- **Cookie CSRF and revoked-session bypass:** The API authentication tests passed cookie/refresh CSRF rejection, whitespace-Bearer cases, session revocation, logout, and SSE-ticket separation. No concrete bypass was found.
- **Duplicate or lost ticket/card transitions:** Ticket command-id concurrency, card issue/revoke idempotency, and lifecycle transition suites passed. Unique constraints, row locks, and replay logic prevent the investigated duplicate-transition scenarios.
- **Readiness and daily-plan state corruption:** Blocking-ticket, occupancy/archive, departure effect, import, and manual/import race tests passed. Existing transaction and unique-key safeguards prevented the investigated invalid room/task state transitions.
- **Permission-matrix last-admin race:** The source test run had an intermittent-looking failure when the full test command shared one mutable RoleGrant database across concurrent test files. The exact focused test passed in isolation, and the implementation serializes `permissions.manage` rows with `FOR UPDATE`; this was excluded as unconfirmed.

## D. Verification Limitations

The audit was source- and test-environment based. It did not exercise a production database, deployed reverse proxy/TLS setup, real third-party notification delivery, long-duration background scheduling, or production traffic volumes. The locally configured test database was used only through the repository's test infrastructure and temporary isolated reproductions.

The reported cleaning deadlock prevents a clean all-green run of the aggregate cleaning lifecycle suite. Additional test-harness timeouts in lock-holder eligibility cases are recorded above as limitations, not inflated into separate confirmed issues.

## E. Final Assessment

The codebase demonstrates substantial defensive engineering, and most high-risk authorization, data-scope, idempotency, and state-transition paths were verified successfully. The confirmed defects are narrow but real: one P1 lock-order deadlock in a core cleaning lifecycle race, and two P2 inconsistencies between configured/online behavior and client or offline-sync behavior.

No P0 defect was confirmed within the verified audit scope.
