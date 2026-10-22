# Incident response

1. Record the current release SHA, incident start time, affected workflows, and operator actions.
2. Check the external HTTPS probe first, then Caddy logs, `/health/ready`, API JSON logs/request IDs, Prometheus alerts, PostgreSQL exporter, disk space, and latest backup timestamp.
3. For an API outage, preserve evidence, check migration/bootstrap exit status and database connectivity, then roll back the application image only if its schema remains compatible.
4. For database corruption or lost data, stop writes and follow `db-recovery.md`; restore only into a verified isolated target until the recovery decision is approved by the data owner.
5. For suspected credential exposure, rotate the affected secret in the provider and deployment secret store, invalidate sessions where needed, and inspect audit history. Do not paste credentials or request bodies into incident notes.
6. Keep the incident open until the external probe, readiness, login, one representative write, SSE delivery, and backup monitor are healthy. Record follow-up work and measured recovery time.

Alertmanager is configured to deliver resolved/firing alerts to `ALERT_WEBHOOK_URL`; provide an authenticated, monitored webhook endpoint. The default local fallback is intentionally non-routable and is not production alerting.
