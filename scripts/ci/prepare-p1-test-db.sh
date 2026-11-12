#!/usr/bin/env bash
# Shared CI helper: create/migrate maintenance_p1_test and write api/.env.p1_test.
# Does not print DATABASE_URL (contains password). Re-runs are idempotent.
#
# Usage (from repo root, or set API_DIR):
#   scripts/ci/prepare-p1-test-db.sh --seed=npm --web-origin=http://127.0.0.1:5173
#   scripts/ci/prepare-p1-test-db.sh --seed=register --web-origin=http://127.0.0.1:5173 --migrate-plain
#   scripts/ci/prepare-p1-test-db.sh --seed=none
#   scripts/ci/prepare-p1-test-db.sh --env-only --web-origin=http://127.0.0.1:5185
#
# Local Windows tip: prefer `node scripts/ci/prepare-p1-test-db.mjs` (no host psql).
set -euo pipefail

DB_NAME="maintenance_p1_test"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-maintenance}"
API_DIR="${API_DIR:-api}"
DOCKER_DB_CONTAINER="${CI_DOCKER_DB_CONTAINER:-}"
DOCKER_DB_SERVICE="${CI_DOCKER_DB_SERVICE:-db}"

SEED="none"
WEB_ORIGIN=""
MIGRATE_PLAIN=0
ENV_ONLY=0
INSTALL_CLIENT=1
CONNECTION_LIMIT=10
PSQL_MODE="host"

usage() {
  echo "Usage: $0 [--seed=none|npm|register] [--web-origin=URL] [--migrate-plain] [--env-only] [--skip-client-install]" >&2
  exit 2
}

for arg in "$@"; do
  case "$arg" in
    --seed=none|--seed=npm|--seed=register) SEED="${arg#--seed=}" ;;
    --web-origin=*) WEB_ORIGIN="${arg#--web-origin=}" ;;
    --migrate-plain) MIGRATE_PLAIN=1 ;;
    --env-only) ENV_ONLY=1 ;;
    --skip-client-install) INSTALL_CLIENT=0 ;;
    -h|--help) usage ;;
    *) echo "Unknown argument: $arg" >&2; usage ;;
  esac
done

if [[ -z "${PGPASSWORD:-}" ]]; then
  echo "PGPASSWORD is required" >&2
  exit 1
fi

DATABASE_URL_PLAIN="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB_NAME}?schema=public"
DATABASE_URL_LIMITED="${DATABASE_URL_PLAIN}&connection_limit=${CONNECTION_LIMIT}"

write_env() {
  local env_path="${API_DIR}/.env.p1_test"
  local lines=(
    "DATABASE_URL=\"${DATABASE_URL_LIMITED}\""
    "EXPECTED_TEST_DATABASE=${DB_NAME}"
    "JWT_SECRET=ci-test-secret-at-least-32-chars-long!!"
  )
  if [[ -n "${WEB_ORIGIN}" ]]; then
    lines+=("WEB_ORIGIN=${WEB_ORIGIN}")
  fi
  printf '%s\n' "${lines[@]}" > "${env_path}"
  echo "Wrote ${env_path} (DATABASE_URL redacted; EXPECTED_TEST_DATABASE=${DB_NAME})"
}

validate_target() {
  if [[ "${DB_NAME}" != "maintenance_p1_test" ]]; then
    echo "Refusing unexpected P1 database name: ${DB_NAME}" >&2
    exit 1
  fi
  local path_db
  path_db="$(printf '%s' "${DATABASE_URL_PLAIN}" | sed -n 's#.*/\([^/?]*\).*#\1#p')"
  if [[ "${path_db}" != "${DB_NAME}" ]]; then
    echo "Refusing migrate/seed: URL database '${path_db}' != '${DB_NAME}'" >&2
    exit 1
  fi
}

resolve_docker_db_container() {
  if [[ -n "${DOCKER_DB_CONTAINER}" ]]; then
    return 0
  fi
  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi
  if docker compose ps -q "${DOCKER_DB_SERVICE}" >/dev/null 2>&1; then
    DOCKER_DB_CONTAINER="$(docker compose ps -q "${DOCKER_DB_SERVICE}" | head -n 1)"
  fi
  [[ -n "${DOCKER_DB_CONTAINER}" ]]
}

run_psql() {
  case "${PSQL_MODE}" in
    host)
      psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" "$@"
      ;;
    docker)
      docker exec -e PGPASSWORD="${PGPASSWORD}" -i "${DOCKER_DB_CONTAINER}" \
        psql -U "${PGUSER}" "$@"
      ;;
    *)
      echo "Unknown PSQL_MODE=${PSQL_MODE}" >&2
      exit 1
      ;;
  esac
}

ensure_client() {
  if command -v psql >/dev/null 2>&1; then
    PSQL_MODE="host"
    echo "Using host psql client"
    return 0
  fi
  if resolve_docker_db_container; then
    PSQL_MODE="docker"
    echo "Using docker exec psql via container ${DOCKER_DB_CONTAINER}"
    return 0
  fi
  if [[ "${INSTALL_CLIENT}" -eq 1 ]] && command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client
    PSQL_MODE="host"
    return 0
  fi
  echo "psql is required (install postgresql-client, or start docker compose db)" >&2
  exit 1
}

create_database() {
  echo "Ensuring database ${DB_NAME} exists on ${PGHOST}:${PGPORT} (role ${PGUSER}, mode=${PSQL_MODE})"
  set +e
  OUT="$(run_psql -d postgres -c "CREATE DATABASE ${DB_NAME} OWNER ${PGUSER};" 2>&1)"
  EC=$?
  set -e
  if [[ $EC -ne 0 ]]; then
    if echo "$OUT" | grep -qiE 'already exists|duplicate_database'; then
      echo "Database ${DB_NAME} already exists — continuing"
    else
      echo "$OUT" >&2
      exit 1
    fi
  fi
}

migrate() {
  validate_target
  local url="${DATABASE_URL_LIMITED}"
  if [[ "${MIGRATE_PLAIN}" -eq 1 ]]; then
    url="${DATABASE_URL_PLAIN}"
  fi
  echo "Migrating ${DB_NAME}"
  (cd "${API_DIR}" && DATABASE_URL="${url}" npx prisma migrate deploy)
}

seed() {
  validate_target
  case "${SEED}" in
    none)
      echo "Skipping demo seed for ${DB_NAME}"
      ;;
    npm)
      echo "Seeding ${DB_NAME} via npm run db:seed"
      (cd "${API_DIR}" && \
        DATABASE_URL="${DATABASE_URL_LIMITED}" \
        DEMO_SEED_DATABASE_NAME="${DB_NAME}" \
        npm run db:seed)
      ;;
    register)
      echo "Seeding ${DB_NAME} via registerP1TestEnv.mjs"
      (cd "${API_DIR}" && \
        DATABASE_URL="${DATABASE_URL_PLAIN}" \
        DEMO_SEED_DATABASE_NAME="${DB_NAME}" \
        node --import ./tests/registerP1TestEnv.mjs --import tsx prisma/seed.ts)
      ;;
    *)
      echo "Invalid --seed=${SEED}" >&2
      exit 2
      ;;
  esac
}

if [[ "${ENV_ONLY}" -eq 1 ]]; then
  validate_target
  write_env
  exit 0
fi

ensure_client
create_database
if [[ "${SEED}" == "register" ]]; then
  write_env
  migrate
  seed
else
  migrate
  seed
  write_env
fi