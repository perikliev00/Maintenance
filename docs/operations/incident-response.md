# Incident response

1. Record the current release SHA, incident start time, affected workflows, and operator actions.
2. Check the external HTTPS probe first, then Caddy logs, `/health/ready`, API JSON logs/request IDs, Prometheus alerts, PostgreSQL exporter, disk space, and latest backup timestamp.
3. For an API outage, preserve evidence, check migration/bootstrap exit status and database connectivity, then roll back the application image only if its schema remains compatible.
4. For database corruption or lost data, stop writes and follow `db-recovery.md`; restore only into a verified isolated target until the recovery decision is approved by the data owner.
5. For suspected credential exposure, rotate the affected secret in the provider and deployment secret store, invalidate sessions where needed, and inspect audit history. Do not paste credentials or request bodies into incident notes.
6. Keep the incident open until the external probe, readiness, login, one representative write, SSE delivery, and backup monitor are healthy. Record follow-up work and measured recovery time.

## Monitoring go-live (OPS-006 / MON-02)

“Monitoring enabled” for Meridian Maintenance means **all** of the following — not merely starting the Compose `monitoring` profile:

1. **Alertmanager webhook is real.** Set `ALERT_WEBHOOK_URL` in `.env.production` to an authenticated, monitored receiver (PagerDuty Events API, Slack incoming webhook behind a relay, Opsgenie, etc.).  
   - Compose default when unset: `http://127.0.0.1:9/not-configured` — fail-visible, **not** production alerting.  
   - Go-live checklist item: fire a test alert (or temporarily lower a threshold in staging) and confirm human notification.
2. **External uptime / dead-man** outside the Compose project failure domain:  
   - Probe `https://$APP_DOMAIN/api/health/ready` from an external checker (UptimeRobot, Better Stack, Pingdom, Cloud watchdog, etc.).  
   - Separately, configure `BACKUP_HEARTBEAT_URL` on the backup timer (or an equivalent external dead-man) so a dead host still surfaces “backup missed”. Host textfile metrics (`backup_last_success_timestamp_seconds`) die with the host.
3. **Prometheus/Alertmanager/Grafana** run with the `monitoring` profile and scrape targets healthy.  
4. Operators know how to silence/ack alerts without disabling the webhook.

Until (1) and (2) are true, treat monitoring as **NOT READY** even if containers are up.

Alertmanager delivers resolved/firing alerts to `ALERT_WEBHOOK_URL`. The default local fallback is intentionally non-routable and is not production alerting.

`start-alertmanager.sh` writes this URL to a mode-0600 file under `/tmp` and
executes Alertmanager. The YAML uses `url_file`; no environment-expansion flag,
envsubst, or URL insertion into YAML is required. The container healthcheck probes
`/-/ready`. Recreate the container after changing the environment variable.

## Backup stale alert note

`MaintenanceBackupStale` fires when `time() - backup_last_success_timestamp_seconds > 90000` (~25 hours). With an **hourly** dump timer this means “missed roughly a day of backups,” not “missed one hour.” Tighter backup SLO should use the external dead-man / `BACKUP_HEARTBEAT_URL`, not only this rule.
