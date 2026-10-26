# Meridian Maintenance — Executive Summary

**Audit date:** 2026-10-25  
**Baseline:** `737cf36` (`main`, tracking `origin/main`)  
**B0–B4 remediations:** 2026-10-25 … 2026-10-26 (uncommitted working tree)  
**Detail reports:** [Master](./MAINTENANCE_MASTER_AUDIT.md) · [Bugs](./MAINTENANCE_BUG_REPORT.md) · [Features](./MAINTENANCE_MISSING_FEATURES.md) · [Security/DevOps](./MAINTENANCE_SECURITY_DEVOPS_AUDIT.md) · [Production readiness](./MAINTENANCE_PRODUCTION_READINESS.md) · [Roadmap](./MAINTENANCE_DEVELOPMENT_ROADMAP.md) · [Regression plan](./MAINTENANCE_REGRESSION_TEST_PLAN.md)

---

## What is the actual condition of the project?

Meridian Maintenance is a **mature TypeScript monorepo** with strong domain coverage and defensive engineering. Batches **B0–B3** closed HIGH defects, reliability, ops docs/tooling, and maintainability items. **B4** shipped offline ticket assign/close/reopen parity (**FEAT-002 / P4-T01**); other P4 product items remain deferred.

It remains **not production-certified for unsupervised go-live**. Operators must still provision secrets/TLS/GHCR Environments, install the backup timer against real S3, wire a live alert webhook + external uptime, and re-measure restore on a production-sized dump. Local Postgres/Docker was unavailable for B4 DB smoke.

---

## What is working well?

- Cleaning + ticket lifecycles; deadlock-safe lock orders; cleaning/ticket assignee bypass aligned.  
- Notifications RoleGrant panel + inbox cursor UI; JWT HS256 pin; legacy helpers unexported; oxlint CI; rooms list cap.  
- **Offline ticket lifecycle** now includes assign/close/reopen through `/sync/push` + outbox (same grants as HTTP).  
- Ops docs: backup install + local restore drill; deploy GHCR gates; OSV on main.

---

## What is still open?

| Area | Notes |
| --- | --- |
| Operator secrets / DNS / TLS / GHCR | RISK-02 |
| Off-host S3 backup + staging-sized restore | Local drill only |
| Live alert webhook + external uptime | Documented; not wired |
| Digest pin / multi-replica (P3-T06) | Deferred |
| Product | P4-T02…T07 deferred (email/push, attachments, PMS, encoder, QR confirm, `hk_lead`) |
| Rooms cursor pagination | Cap mitigates; full cursor residual |

---

## Is the project production-ready?

**NOT READY for unsupervised production.**  
**PARTIALLY READY for controlled staging** after the [Production readiness](./MAINTENANCE_PRODUCTION_READINESS.md) operator checklist (secrets, TLS, owner bootstrap, real webhook, backup timer on S3, staging-sized restore).

B0–B4 code batches **do not** equal production certification.

---

## Top next tasks (post-roadmap)

1. **Operator B2 residuals** — S3-sized restore drill, live webhook + external uptime, secrets/TLS/GHCR.  
2. Re-run isolation DB smoke (`assign.start.concurrency`, sync assignee suites, new assign/close/reopen sync test) when Postgres is up.  
3. Deferred product (**P4-T02…T07**) only when explicitly scoped — **no automatic B5**.

---

## What should the next session address first?

**Operator production checklist** (B2 residuals), unless product work (e.g. attachments / QR confirm) is explicitly requested.

Do **not** reopen B0–B4 unless a regression is proven. Do **not** start P3-T06 unless multi-replica is required.

Full status: [Roadmap](./MAINTENANCE_DEVELOPMENT_ROADMAP.md).
