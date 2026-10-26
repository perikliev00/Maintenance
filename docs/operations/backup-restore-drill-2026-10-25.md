# Backup / restore drill evidence — 2026-10-25 (Batch B2)

**Scope:** Disposable local Docker Postgres only. No production data. No S3 upload (local age-encrypted artifact).

## Environment

| Item | Value |
| --- | --- |
| Host | Windows operator workstation + Docker Desktop |
| Postgres container | `maintenance-db-1` (`postgres:16-alpine`, host `:5433`) |
| Source DB | `maintenance_p1_test` (isolated test DB) |
| Target DB | `maintenance_restore_drill` (created for drill, disposable) |
| Encryption | Ephemeral `age` identity via `alpine:3.20` |
| Runner | `scripts/run-local-restore-drill.ps1` |

## Commands

```powershell
cd <repo>
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-local-restore-drill.ps1
```

## Measured results

| Metric | Value |
| --- | --- |
| Dump wall clock | <1s (reported `dump_seconds=0` at 1s resolution) |
| Restore + decrypt wall clock | **2 seconds** |
| Combined dump+restore | **~2 seconds** |
| Verify: `"User"` count | 1 (>0 gate) |
| Verify: applied `_prisma_migrations` | 35 (>0 gate) |
| Result | **pass** |

Machine-readable copy: `.drill-backup/drill-result.env` (gitignored).

## RPO / RTO interpretation (honest)

| Claim | Status after this drill |
| --- | --- |
| Hourly systemd dump timer installable | **Documented** (`backup-install.md` + unit examples) |
| RPO ≤15 minutes | **NOT met / NOT claimed** — hourly dumps → typical RPO **&lt;60m** (+ timer jitter). 15m needs PITR/WAL. |
| RTO ≤60 minutes | **Local evidence only** — restore completed in **2s** on a tiny disposable DB. Production RTO still depends on dump size, network, S3, and host resources; re-measure on staging with a production-sized dump. |
| Off-host S3 backup path | **NOT exercised this session** (no drill S3 credentials). Scripts support `BACKUP_S3_URI`; local mode used `BACKUP_LOCAL_DIR` equivalent via Docker age files. |

## Residual

- Re-run on a Linux staging host with real `BACKUP_S3_URI` + production-sized dump before go-live sign-off.
- Install systemd timer per `backup-install.md`.
- Keep `BACKUP_HEARTBEAT_URL` / external dead-man — host textfile metrics die with the host.
