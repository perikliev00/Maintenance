# Backup install (self-host)

Schedule encrypted off-host dumps with the example systemd units. Hourly dumps give a **starting RPO under ~60 minutes**. An **RPO ≤15 minutes** requires managed PITR or base backup + WAL archiving — do not claim 15m from this timer alone.

## Prerequisites

- Checkout at `/opt/maintenance` (or adjust paths in the unit files)
- `pg_dump`, `age`, `aws` (v2) on `PATH` for the backup user
- Dedicated OS user `maintenance-backup` (no login shell)
- S3 prefix with versioning / object-lock per hotel policy
- Age **recipient** (public) for encrypt; identity kept **off** the backup bucket

## Install steps

1. Create the service account and directories:

```sh
sudo useradd --system --home /var/lib/maintenance-backup --shell /usr/sbin/nologin maintenance-backup
sudo mkdir -p /etc/maintenance /opt/maintenance/infra/monitoring/textfile
sudo chown maintenance-backup:maintenance-backup /opt/maintenance/infra/monitoring/textfile
```

2. Write `/etc/maintenance/backup.env` (mode `0600`, owner `maintenance-backup`):

```sh
DATABASE_URL=postgresql://backup_role:...@db-host:5432/maintenance?sslmode=require
BACKUP_S3_URI=s3://your-offhost-bucket/maintenance-pg/
BACKUP_AGE_RECIPIENT=age1...
# Optional dead-man for when the host itself is down:
# BACKUP_HEARTBEAT_URL=https://uptime.example/heartbeat/maintenance-backup
# BACKUP_METRICS_FILE is set by the systemd unit example
```

3. Install units from the repo examples:

```sh
sudo cp infra/backup/maintenance-backup.service.example /etc/systemd/system/maintenance-backup.service
sudo cp infra/backup/maintenance-backup.timer.example /etc/systemd/system/maintenance-backup.timer
# Edit paths if the checkout is not /opt/maintenance
sudo systemctl daemon-reload
sudo systemctl enable --now maintenance-backup.timer
sudo systemctl list-timers 'maintenance-backup*'
sudo systemctl start maintenance-backup.service   # first run
sudo journalctl -u maintenance-backup.service -n 50 --no-pager
```

4. Apply lifecycle JSON (`infra/backup/s3-lifecycle.example.json`) to the backup prefix after adjusting retention.

5. Confirm Prometheus scrapes `backup_last_success_timestamp_seconds` via node-exporter textfile, **and** that Alertmanager has a real `ALERT_WEBHOOK_URL` (see `incident-response.md`). Host textfile metrics alone are not enough if the host is down — configure `BACKUP_HEARTBEAT_URL` or an external uptime check.

## Local / staging drill (no S3)

Scripts accept `BACKUP_LOCAL_DIR` / `BACKUP_LOCAL_FILE` instead of S3:

```sh
# Generate an ephemeral age identity for the drill only
age-keygen -o /tmp/drill-age.key
recip="$(grep -o 'age1[0-9a-z]*' /tmp/drill-age.key.pub 2>/dev/null || age-keygen -y /tmp/drill-age.key)"

export DATABASE_URL='postgresql://.../maintenance_p1_test'
export BACKUP_AGE_RECIPIENT="$recip"
export BACKUP_LOCAL_DIR=/tmp/maintenance-backups
./scripts/backup-db.sh

# Create disposable DB, then:
export BACKUP_LOCAL_FILE=/tmp/maintenance-backups/maintenance-....dump.age
export BACKUP_AGE_IDENTITY_FILE=/tmp/drill-age.key
export RESTORE_DATABASE_URL='postgresql://.../maintenance_restore_drill'
export RESTORE_DATABASE_NAME=maintenance_restore_drill
./scripts/verify-restore.sh
```

Record wall-clock restore time in the drill log. B2 (2026-10-25) completed a local measured disposable drill; re-measure on staging-sized S3 dumps before go-live.

## Related

- Restore procedure: `db-recovery.md`
- Alerts / uptime: `incident-response.md`
- Lifecycle example: `infra/backup/s3-lifecycle.example.json`
