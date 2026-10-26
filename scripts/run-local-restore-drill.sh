#!/usr/bin/env bash
# Measured restore drill using Dockerized pg_* + age against a disposable DB.
# Does NOT touch production. Default source DB: maintenance_p1_test on local Compose Postgres.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_CONTAINER="${PG_CONTAINER:-maintenance-db-1}"
PG_USER="${PG_USER:-maintenance}"
SOURCE_DB="${SOURCE_DB:-maintenance_p1_test}"
DRILL_DB="${DRILL_DB:-maintenance_restore_drill}"
WORK="${WORK_DIR:-$ROOT/.drill-backup}"
AGE_IMAGE="${AGE_IMAGE:-alpine:3.20}"

mkdir -p "$WORK"
chmod 700 "$WORK" || true

echo "== B2 restore drill =="
echo "source_db=$SOURCE_DB drill_db=$DRILL_DB container=$PG_CONTAINER work=$WORK"

docker inspect "$PG_CONTAINER" >/dev/null

echo "-- generate ephemeral age identity"
docker run --rm -v "$WORK:/work" -w /work "$AGE_IMAGE" \
  sh -c 'apk add --no-cache age >/dev/null && age-keygen -o /work/drill-age.key 2>/work/drill-age.pub'
# age-keygen prints public key to stderr; also write .pub via -y
docker run --rm -v "$WORK:/work" -w /work "$AGE_IMAGE" \
  sh -c 'apk add --no-cache age >/dev/null && age-keygen -y /work/drill-age.key > /work/drill-age.recipient'
RECIPIENT="$(tr -d '\r\n' < "$WORK/drill-age.recipient")"
test -n "$RECIPIENT"

echo "-- create disposable database $DRILL_DB"
docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = '${DRILL_DB}' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS ${DRILL_DB};
CREATE DATABASE ${DRILL_DB} OWNER ${PG_USER};
SQL

echo "-- pg_dump $SOURCE_DB (custom format)"
t0="$(date -u +%s)"
docker exec -i "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$SOURCE_DB" --format=custom --no-owner --no-acl -f /tmp/drill.dump
docker cp "$PG_CONTAINER:/tmp/drill.dump" "$WORK/drill.dump"
dump_s=$(( $(date -u +%s) - t0 ))
echo "dump_seconds=$dump_s"

echo "-- age encrypt → local file"
docker run --rm -v "$WORK:/work" -w /work "$AGE_IMAGE" \
  sh -c "apk add --no-cache age >/dev/null && age --recipient '$RECIPIENT' -o /work/drill.dump.age /work/drill.dump"
rm -f "$WORK/drill.dump"
chmod 600 "$WORK/drill.dump.age" "$WORK/drill-age.key" || true

echo "-- age decrypt + pg_restore into $DRILL_DB"
t1="$(date -u +%s)"
docker run --rm -v "$WORK:/work" -w /work "$AGE_IMAGE" \
  sh -c 'apk add --no-cache age >/dev/null && age --decrypt --identity /work/drill-age.key -o /work/drill.restored.dump /work/drill.dump.age'
docker cp "$WORK/drill.restored.dump" "$PG_CONTAINER:/tmp/drill.restored.dump"
docker exec -i "$PG_CONTAINER" pg_restore -U "$PG_USER" -d "$DRILL_DB" --clean --if-exists --no-owner --no-acl /tmp/drill.restored.dump
restore_s=$(( $(date -u +%s) - t1 ))
echo "restore_seconds=$restore_s"

echo "-- verify gates (User + _prisma_migrations)"
users="$(docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$DRILL_DB" -Atc 'SELECT count(*) FROM "User"')"
migs="$(docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$DRILL_DB" -Atc 'SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL')"
echo "users=$users migrations=$migs"
test "$users" -gt 0
test "$migs" -gt 0

total_s=$(( dump_s + restore_s ))
echo "-- RESULT pass dump_s=${dump_s}s restore_s=${restore_s}s wall_backup_plus_restore_s=${total_s}s"
echo "RPO_assumption=hourly_dump_not_15m_without_PITR"
echo "artifact=$WORK/drill.dump.age"

# Cleanup decrypted material; keep encrypted artifact + identity for audit path if needed
rm -f "$WORK/drill.restored.dump"
docker exec -i "$PG_CONTAINER" rm -f /tmp/drill.dump /tmp/drill.restored.dump || true
