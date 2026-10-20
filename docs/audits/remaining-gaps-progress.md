# Remaining Maintenance gaps — progress

Baseline: `be19cb20e831f25ce726c61c678cbb5c689a3860`, clean checkout, 2026-10-20.
The supplied dossier is evidence to verify, not a statement that every claim is current.
No production deployment, push, or working database mutation is authorized by this work.

| Scenario | State | Evidence / next action |
|---|---|---|
| CI isolation | VERIFIED | Temporary .env shared by both workers; original marker/name assertions retained plus exact fixture assertion. Proof passes. |
| P0-06 | VERIFIED | Two observed refresh claim waiters; one winner, one active successor, no extra session. Revoked-read/reuse branch remains covered. |
| P0-10 | Final regression running | Batch/fallback/online command identity guards, ABA revision, cookie ordering, stale /me protection; server original-owner header rejects actual cookie mismatch before writes. Unit+HTTP evidence passes; browser rerun includes login-CSRF correction. |
| P1-03 | VERIFIED | Two observed owner lock waiters; exactly200/409 and one remaining owner; ordered locks. |
| P1-04 | VERIFIED | Two observed grant lock waiters; exactly200/400 and one manage grant; ordered locks. |
| P1-08 | VERIFIED | Full-response negative controls across both analytics domains/live, with manager positive deltas;7/7 scoped suite. |
| P1-11 | VERIFIED | Both creates observed waiting; one active task, cycle+1, unchanged dirty state. |
| P1-12 | VERIFIED | Both inserts observed waiting; losing task/location/audit unchanged and no losing session. |
| P1-15 | VERIFIED | Shared User locks through commit, including plan/departure/starter paths;17/17 tests with late SQL barriers and exact User UPDATE waiters. |
| P1-21 | VERIFIED | Both approve-first and reject-first forced, winner/status/location/one inspection asserted. |
| P1-25 | VERIFIED | Real defect reproduced in4 overlap cases; fixed locked replay check.5/5 start/complete/cancel/approve/reject cases: one audit/version/event and exact notifications; unchanged graph on replay. |
| P1-27 | VERIFIED | Terminal refusal snapshots, allowed rework/awaiting, idle-looking running-session refusal;10/10 suite. |
| P1-29 | VERIFIED | Forced start-first/reassign-first, explicit winner and matching running assignee. |
| P1-35 | VERIFIED | Operational task/session/ticket/plan/overdue/MyWork filters; archive/restore preserves graph and history. |
| P1-44 | VERIFIED | Four duplicate lifecycle paths observed at actual DB lock barrier; one event and one state/SLA effect. |
| P1-46 | VERIFIED | Both ticket inserts wait at real DB barrier; one ticket and initial event. |
| P1-68 | VERIFIED | Keyset API+UI;>50, timestamp ties, removed cursor row, ownership, invalid parameters. Real browser55-ticket workflow passes. |
| P1-110 | Final regression running | Real offline cleaning start+complete reconciles session/version/inspection/cache/reload; targeted workflow passed. |
| P1-115 | Strengthening final review finding | Pre-delivery checks remove heartbeat cache window; independent review identified in-flight authorization TOCTOU. Adding authorization gate and controlled regression before declaring DONE. |
| P1-117 | Final regression running |8 real-page subscription cases and busy-action deferral; targeted run passed after harness binding correction. |
| P1-127 | VERIFIED | Late SQL fault matrix extends cancel/reassign/reject and assign/wait/resume/resolve/close/reopen; exact graph rollback incl audit/notifications/reopen history;3/3 suite. |
| P2-43 | VERIFIED |9 real-component A→B late success/error/loading cases across Analytics/Results/Repairs. |

Each scenario requires production review, meaningful assertions, executed tests, and a separate post-implementation review before DONE. Unexecuted DB/browser checks will be recorded as NOT VERIFIED.

## Execution and review log

- Initial proof failed because configured localhost:5433 was unavailable. Docker was unavailable; created a fresh scratch PostgreSQL18 cluster on loopback55439. Never connected mutating tests to the working database.
- Applied all35 migrations and seeded only scratch maintenance_p1_test. Temporarily repointed ignored .env.p1_test, with original backed up outside the repository; .env untouched.
- Isolation proof passed; baseline previously-blocked scenarios71/71 passed.
- First deterministic concurrency batch23/23 passed. Replaced unordered cleaning inspection/start races with both forced orderings, and added loser snapshots.
- New overlap tests reproduced four real P1-25 failures (completed/cancelled/approved/rejected state refusal), then5/5 passed after locked command rechecks and added start coverage.
- Independent test audit requested pre-operation side-effect baselines; added exact one audit, exact notification recipients/dedupe keys, one bus event, version+1, and unchanged full graph for sequential replay. Re-reviewed with no remaining finding.
- Independent security review found delayed refresh cookies, second-refresh races, stale online-or-enqueue fallback, stale /me response, and actual-cookie/local-binding mismatch. Corrections include ordered login/logout, revision guards, original-owner headers plus API validation and positive real batch/fallback writes.
- Full serial isolated API suites:563/563 passed,111 suites,0 skipped (166.7s), before final optional identity-header hardening. Auth/sync15/15 and final sync7/7 passed afterward. Latest API build/test typecheck passed.
- Browser first full run50/52 passed. Real cleaning reconciliation passed. Two failures exposed missing harness identity binding and login CSRF with existing session cookies; both corrected; full rerun in progress.
- Separate independent review remains active for strict SSE authorization ordering before final verification.
