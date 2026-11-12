#!/usr/bin/env bash
# Measured restore drill using Dockerized pg_* + age against a disposable DB.
# Does NOT touch production. Default source DB: maintenance_p1_test on local Compose Postgres.
set -euo pipefail

# Assign a configuration or runtime variable.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Assign a configuration or runtime variable.
PG_CONTAINER="${PG_CONTAINER:-maintenance-db-1}"
# Assign a configuration or runtime variable.
PG_USER="${PG_USER:-maintenance}"
# Assign a configuration or runtime variable.
SOURCE_DB="${SOURCE_DB:-maintenance_p1_test}"
# Assign a configuration or runtime variable.
DRILL_DB="${DRILL_DB:-maintenance_restore_drill}"
# Assign a configuration or runtime variable.
WORK="${WORK_DIR:-$ROOT/.drill-backup}"
# Assign a configuration or runtime variable.
AGE_IMAGE="${AGE_IMAGE:-alpine:3.20}"

# Run an external command needed by this step.
mkdir -p "$WORK"
# Run an external command needed by this step.
chmod 700 "$WORK" || true

# Print status or usage information.
echo "== B2 restore drill =="
# Print status or usage information.
echo "source_db=$SOURCE_DB drill_db=$DRILL_DB container=$PG_CONTAINER work=$WORK"

# Run an external command needed by this step.
docker inspect "$PG_CONTAINER" >/dev/null

# Print status or usage information.
echo "-- generate ephemeral age identity"
# Run an external command needed by this step.
docker run --rm -v "$WORK:/work" -w /work "$AGE_IMAGE" \
  # Support the surrounding script logic for this step.
  sh -c 'apk add --no-cache age >/dev/null && age-keygen -o /work/drill-age.key 2>/work/drill-age.pub'
# age-keygen prints public key to stderr; also write .pub via -y
docker run --rm -v "$WORK:/work" -w /work "$AGE_IMAGE" \
  # Support the surrounding script logic for this step.
  sh -c 'apk add --no-cache age >/dev/null && age-keygen -y /work/drill-age.key > /work/drill-age.recipient'
# Assign a configuration or runtime variable.
RECIPIENT="$(tr -d '\r\n' < "$WORK/drill-age.recipient")"
# Evaluate a shell test condition.
test -n "$RECIPIENT"

# Print status or usage information.
echo "-- create disposable database $DRILL_DB"
# Run an external command needed by this step.
docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL
# Support the surrounding script logic for this step.
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  # Support the surrounding script logic for this step.
  WHERE datname = '${DRILL_DB}' AND pid <> pg_backend_pid();
# Support the surrounding script logic for this step.
DROP DATABASE IF EXISTS ${DRILL_DB};
# Support the surrounding script logic for this step.
CREATE DATABASE ${DRILL_DB} OWNER ${PG_USER};
# Support the surrounding script logic for this step.
SQL

# Print status or usage information.
echo "-- pg_dump $SOURCE_DB (custom format)"
# Assign a configuration or runtime variable.
t0="$(date -u +%s)"
# Run an external command needed by this step.
docker exec -i "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$SOURCE_DB" --format=custom --no-owner --no-acl -f /tmp/drill.dump
# Run an external command needed by this step.
docker cp "$PG_CONTAINER:/tmp/drill.dump" "$WORK/drill.dump"
# Assign a configuration or runtime variable.
dump_s=$(( $(date -u +%s) - t0 ))
# Print status or usage information.
echo "dump_seconds=$dump_s"

# Print status or usage information.
echo "-- age encrypt → local file"
# Run an external command needed by this step.
docker run --rm -v "$WORK:/work" -w /work "$AGE_IMAGE" \
  # Support the surrounding script logic for this step.
  sh -c "apk add --no-cache age >/dev/null && age --recipient '$RECIPIENT' -o /work/drill.dump.age /work/drill.dump"
# Run an external command needed by this step.
rm -f "$WORK/drill.dump"
# Run an external command needed by this step.
chmod 600 "$WORK/drill.dump.age" "$WORK/drill-age.key" || true

# Print status or usage information.
echo "-- age decrypt + pg_restore into $DRILL_DB"
# Assign a configuration or runtime variable.
t1="$(date -u +%s)"
# Run an external command needed by this step.
docker run --rm -v "$WORK:/work" -w /work "$AGE_IMAGE" \
  # Support the surrounding script logic for this step.
  sh -c 'apk add --no-cache age >/dev/null && age --decrypt --identity /work/drill-age.key -o /work/drill.restored.dump /work/drill.dump.age'
# Run an external command needed by this step.
docker cp "$WORK/drill.restored.dump" "$PG_CONTAINER:/tmp/drill.restored.dump"
# Run an external command needed by this step.
docker exec -i "$PG_CONTAINER" pg_restore -U "$PG_USER" -d "$DRILL_DB" --clean --if-exists --no-owner --no-acl /tmp/drill.restored.dump
# Assign a configuration or runtime variable.
restore_s=$(( $(date -u +%s) - t1 ))
# Print status or usage information.
echo "restore_seconds=$restore_s"

# Print status or usage information.
echo "-- verify gates (User + _prisma_migrations)"
# Assign a configuration or runtime variable.
users="$(docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$DRILL_DB" -Atc 'SELECT count(*) FROM "User"')"
# Assign a configuration or runtime variable.
migs="$(docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$DRILL_DB" -Atc 'SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL')"
# Print status or usage information.
echo "users=$users migrations=$migs"
# Evaluate a shell test condition.
test "$users" -gt 0
# Evaluate a shell test condition.
test "$migs" -gt 0

# Assign a configuration or runtime variable.
total_s=$(( dump_s + restore_s ))
# Print status or usage information.
echo "-- RESULT pass dump_s=${dump_s}s restore_s=${restore_s}s wall_backup_plus_restore_s=${total_s}s"
# Print status or usage information.
echo "RPO_assumption=hourly_dump_not_15m_without_PITR"
# Print status or usage information.
echo "artifact=$WORK/drill.dump.age"

# Cleanup decrypted material; keep encrypted artifact + identity for audit path if needed
rm -f "$WORK/drill.restored.dump"
# Run an external command needed by this step.
docker exec -i "$PG_CONTAINER" rm -f /tmp/drill.dump /tmp/drill.restored.dump || true
