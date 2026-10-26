# Authentication, sync and ticket-notification recovery

## Refresh and logout-all

`POST /auth/refresh` clears cookies only on a confirmed authentication rejection
(401/403). Unexpected storage/infrastructure failures propagate as 5xx and leave
the original cookies available for retry. Expired, revoked and reused refresh
tokens retain their existing rejection/reuse-detection behavior.

`POST /auth/logout-all` accepts a valid refresh credential, or a valid access token
when refresh credentials are absent. Browser refresh credentials require CSRF.
The session is checked under the same User lock as revoke-all, without issuing a
replacement session. The response confirms `{ok: true, revoked: <count>}` before
the client treats global revocation as successful.

Cookie-changing login/logout requests are serialized in the web transport. On a
global-revoke failure the client rejects, attempts to clear this browser's cookies
through ordinary logout, purges its private local state and shows a failure
notice. It does not automatically bootstrap as though global revoke succeeded.

## Offline command retry

Per-command sync errors can include `retryable`. Validation and other permanent
4xx errors use `false`; unexpected failures and transient statuses use `true`.
Conflict and forbidden handling remains separate. Older servers without the
field retain bounded retry behavior.

A pending retry stops later batches until the failed command can be retried in
queue order. Backoff is 2s, 5s, then at most 15s, with eight failed attempts before
the row becomes `failed`. Timers recheck the account binding/revision before
sending; no reload, visibility change or new enqueue is required. Successful
commands are removed and are not sent again. Unrelated successful I/O can clear
the network-unreachable banner but cannot cancel a pending command's retry timer
or reset its backoff. Settling the queue or going offline cancels that timer.

## Durable ticket notifications

Migration `20261026200000_ticket_notification_outbox` adds
`TicketNotificationOutbox`. Resolve/close write an intent atomically with their
TicketEvent and audit/state changes. The intent snapshots content, actor and
recipients and uses the event ID in its notification dedupe key.

Immediate delivery is attempted after commit. If it fails, the intent remains
pending. Replaying the same command repairs missing recipient rows without
repeating the domain mutation, event or audit. Concurrent delivery is safe through
the existing unique notification keys. A crash after recipient inserts but before
the delivered marker can also be retried without duplicates.

`runAllJobs()` includes `ticket_notifications`, processing at most 100 pending
intents per cycle, including calls without command IDs. The normal scheduler runs
after its initial 15s delay and every five minutes. Operators can trigger all jobs
through the existing authorized `/jobs/run` endpoint. Failed deliveries remain
pending and report a failed job-cycle outcome. Deleting a TicketEvent cascades its
intent, including isolated test-fixture cleanup.

Disabled in-app notifications retain the existing no-backfill policy: intents
processed while the channel is disabled are completed without notices. Existing
historical events from before this migration are not automatically backfilled.

Apply migrations before the new API starts, using the normal migrate service.
The runtime DB role needs SELECT/INSERT/UPDATE on the new table, through the
deployment's existing grants/default privileges. This change was migrated and
tested only in `maintenance_p1_test`; no working/production database migration or
deployment was performed by the implementation task.

## HTTPS web liveness

Caddy serves `/health` only on loopback `127.0.0.1:8081`. Both the image and Compose
use the same HTTP check against that listener, independent of public DNS, SNI and
automatic HTTPS redirects. The listener is bound to loopback and is not published.
API readiness remains a separate dependency/check.

`scripts/verify-containers.mjs` starts a real HTTPS `localhost` site with Caddy's
temporary internal CA, checks the exact Compose health command and Docker healthy
state, and verifies HTTPS with the generated CA and correct SNI. TLS validation is
not disabled. It also retains the HTTP routing, assets, security/cache headers,
public metrics denial, internal scrape and local-only Alertmanager delivery checks.
