# Database backup and recovery

## Backup setup

**Install guide:** [`backup-install.md`](./backup-install.md) (systemd timer/service, env file, local-drill mode).

Schedule `scripts/backup-db.sh` at least hourly for a starting RPO target under 60 minutes. For a **15-minute RPO**, use managed PITR or PostgreSQL base backups plus WAL archiving; hourly dumps alone do not meet that target. Provide `DATABASE_URL`, `BACKUP_S3_URI` (or `BACKUP_LOCAL_DIR` for drills), and an age recipient through `/etc/maintenance/backup.env` owned by the backup service account. Give the backup identity upload-only access to the backup prefix and separate it from runtime credentials. Enable bucket versioning, off-host replication/object lock where appropriate, and a lifecycle policy matching the approved retention window. Never store encryption identities with encrypted backups.

On successful upload/write the script writes `backup_last_success_timestamp_seconds` into `BACKUP_METRICS_FILE`, if configured, and sends an optional dead-man heartbeat URL. For the bundled monitoring profile, point it to `infra/monitoring/textfile/backup.prom`; node-exporter scrapes that directory. A backup alert without independent external alert routing is not sufficient when the main host is down.

## Restore drill

Create a new isolated database on staging with network access restricted to the recovery operator. Confirm its hostname and database name are disposable. Set `BACKUP_AGE_IDENTITY_FILE`, `RESTORE_DATABASE_URL`, `RESTORE_DATABASE_NAME`, and either `BACKUP_OBJECT_URI` (S3) or `BACKUP_LOCAL_FILE`, then run:

```sh
RESTORE_DISPOSABLE_CONFIRMED=true NODE_ENV=development scripts/verify-restore.sh
# or scripts/restore-db.sh with the same env
```

The script rejects production mode, requires explicit disposable confirmation, checks that the URL database name matches, rejects common live DB names (`maintenance`, `prod`, `production`), decrypts to a mode-0600 temporary file, restores, lists the archive, and checks `"User"` + applied `_prisma_migrations`. The operator then runs the app smoke and domain integrity queries against the restored database. Record measured restore time, row/schema checks, selected backup timestamp, and any gaps. Do not point restore tooling at a production endpoint.

**Measured evidence (B2, 2026-10-25):** local Docker disposable drill completed. Production-sized S3 drill remains operator follow-up.

## Retention and target

Apply `infra/backup/s3-lifecycle.example.json` to the dedicated prefix after adjusting the approved retention period; verify expiration by listing backup timestamps. Alert when a successful backup is over 25 hours old (≈ missed day of hourly dumps), and configure a separate uptime/dead-man monitor for the scheduled uploader. Business targets of RPO ≤15 minutes / RTO ≤60 minutes require PITR (for 15m RPO) and recurring measured drills on representative dump sizes (for RTO).
