# Database backup and recovery

## Backup setup

Install the example systemd service and timer after adjusting the checkout path, and schedule `scripts/backup-db.sh` at least hourly for a starting RPO target under 60 minutes. For a 15-minute RPO, use managed PITR or PostgreSQL base backups plus WAL archiving; hourly dumps alone do not meet that target. Provide `DATABASE_URL`, `BACKUP_S3_URI`, and an age recipient through `/etc/maintenance/backup.env` owned by the backup service account. Give the backup identity upload-only access to the backup prefix and separate it from runtime credentials. Enable bucket versioning, off-host replication/object lock where appropriate, and a lifecycle policy matching the approved retention window. Never store encryption identities with encrypted backups.

On successful upload the script writes `backup_last_success_timestamp_seconds` into `BACKUP_METRICS_FILE`, if configured, and sends an optional dead-man heartbeat URL. For the bundled monitoring profile, point it to `infra/monitoring/textfile/backup.prom`; node-exporter scrapes that directory. A backup alert without independent external alert routing is not sufficient when the main host is down.

## Restore drill

Create a new isolated database on staging with network access restricted to the recovery operator. Confirm its hostname and database name are disposable. Set `BACKUP_OBJECT_URI`, `BACKUP_AGE_IDENTITY_FILE`, `RESTORE_DATABASE_URL`, and `RESTORE_DATABASE_NAME`, then run:

```sh
RESTORE_DISPOSABLE_CONFIRMED=true NODE_ENV=development scripts/restore-db.sh
```

The script rejects production mode, requires explicit disposable confirmation, checks that the URL database name matches, rejects common live DB names, decrypts to a mode-0600 temporary file, restores, lists the archive, and checks the core `User` table. The operator then runs the app smoke and domain integrity queries against the restored database. Record measured restore time, row/schema checks, selected backup timestamp, and any gaps. Do not point restore tooling at a production endpoint.

## Retention and target

Apply `infra/backup/s3-lifecycle.example.json` to the dedicated prefix after adjusting the approved retention period; verify expiration by listing backup timestamps. Alert when a successful backup is over 25 hours old, and configure a separate uptime/dead-man monitor for the scheduled uploader. Starting business targets in the review are RPO ≤15 minutes and RTO ≤60 minutes; confirm them with the hotel operator and measure them in recurring restore drills.
