#!/usr/bin/env bash
# Shared CI helper: create/migrate maintenance_p1_test and write api/.env.p1_test.
# Does not print DATABASE_URL (contains password). Re-runs are idempotent.
#
# Usage (from repo root, or set API_DIR):
#   scripts/ci/prepare-p1-test-db.sh --seed=npm --web-origin=http://127.0.0.1:5173
#   scripts/ci/prepare-p1-test-db.sh --seed=register --web-origin=http://127.0.0.1:5173 --migrate-plain
#   scripts/ci/prepare-p1-test-db.sh --seed=none
#   scripts/ci/prepare-p1-test-db.sh --env-only --web-origin=http://127.0.0.1:5185
set -euo pipefail

# Configure DB_NAME for this CI helper run.
DB_NAME="maintenance_p1_test"
# Configure PGHOST for this CI helper run.
PGHOST="${PGHOST:-localhost}"
# Configure PGPORT for this CI helper run.
PGPORT="${PGPORT:-5432}"
# Configure PGUSER for this CI helper run.
PGUSER="${PGUSER:-maintenance}"
# PGPASSWORD must be provided by the caller / CI job env (never echoed).
API_DIR="${API_DIR:-api}"

SEED="none"          # none | npm | register
WEB_ORIGIN=""        # empty → omit WEB_ORIGIN from .env.p1_test
MIGRATE_PLAIN=0      # 1 → migrate URL without connection_limit (E2E)
ENV_ONLY=0           # 1 → only rewrite .env.p1_test
# Configure INSTALL_CLIENT for this CI helper run.
INSTALL_CLIENT=1
# Configure CONNECTION_LIMIT for this CI helper run.
CONNECTION_LIMIT=10

# Define helper function usage.
usage() {
  # Print status or error guidance for the operator.
  echo "Usage: $0 [--seed=none|npm|register] [--web-origin=URL] [--migrate-plain] [--env-only] [--skip-client-install]" >&2
  # Exit the script with the indicated status.
  exit 2
}

# Iterate arguments or items.
for arg in "$@"; do
  # Dispatch on CLI argument / mode value.
  case "$arg" in
    # Advance the P1 test-database preparation step.
    --seed=none|--seed=npm|--seed=register) SEED="${arg#--seed=}" ;;
    # Advance the P1 test-database preparation step.
    --web-origin=*) WEB_ORIGIN="${arg#--web-origin=}" ;;
    # Advance the P1 test-database preparation step.
    --migrate-plain) MIGRATE_PLAIN=1 ;;
    # Advance the P1 test-database preparation step.
    --env-only) ENV_ONLY=1 ;;
    # Advance the P1 test-database preparation step.
    --skip-client-install) INSTALL_CLIENT=0 ;;
    # Advance the P1 test-database preparation step.
    -h|--help) usage ;;
    # Advance the P1 test-database preparation step.
    *) echo "Unknown argument: $arg" >&2; usage ;;
  # End the case dispatch block.
  esac
# Close the loop body.
done

# Conditional branch for this shell guard.
if [[ -z "${PGPASSWORD:-}" ]]; then
  # Print status or error guidance for the operator.
  echo "PGPASSWORD is required" >&2
  # Exit the script with the indicated status.
  exit 1
# Close the if/elif/else conditional.
fi

# Password is interpolated only into env vars / .env.p1_test — never echoed to logs.
DATABASE_URL_PLAIN="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB_NAME}?schema=public"
# Configure DATABASE_URL_LIMITED for this CI helper run.
DATABASE_URL_LIMITED="${DATABASE_URL_PLAIN}&connection_limit=${CONNECTION_LIMIT}"

# Define helper function write_env.
write_env() {
  # Declare a function-scoped shell variable.
  local env_path="${API_DIR}/.env.p1_test"
  # Declare a function-scoped shell variable.
  local lines=(
    # Advance the P1 test-database preparation step.
    "DATABASE_URL=\"${DATABASE_URL_LIMITED}\""
    # Advance the P1 test-database preparation step.
    "EXPECTED_TEST_DATABASE=${DB_NAME}"
    # Advance the P1 test-database preparation step.
    "JWT_SECRET=ci-test-secret-at-least-32-chars-long!!"
  )
  # Conditional branch for this shell guard.
  if [[ -n "${WEB_ORIGIN}" ]]; then
    # Append optional env line when configured.
    lines+=("WEB_ORIGIN=${WEB_ORIGIN}")
  # Close the if/elif/else conditional.
  fi
  # printf avoids heredoc indent leakage into the env file.
  printf '%s\n' "${lines[@]}" > "${env_path}"
  # Print status or error guidance for the operator.
  echo "Wrote ${env_path} (DATABASE_URL redacted; EXPECTED_TEST_DATABASE=${DB_NAME})"
}

# Define helper function validate_target.
validate_target() {
  # Fail closed: only the fixed P1 isolation database name is allowed.
  if [[ "${DB_NAME}" != "maintenance_p1_test" ]]; then
    # Print status or error guidance for the operator.
    echo "Refusing unexpected P1 database name: ${DB_NAME}" >&2
    # Exit the script with the indicated status.
    exit 1
  # Close the if/elif/else conditional.
  fi
  # Declare a function-scoped shell variable.
  local path_db
  # Extract the database name from the URL path.
  path_db="$(printf '%s' "${DATABASE_URL_PLAIN}" | sed -n 's#.*/\([^/?]*\).*#\1#p')"
  # Conditional branch for this shell guard.
  if [[ "${path_db}" != "${DB_NAME}" ]]; then
    # Print status or error guidance for the operator.
    echo "Refusing migrate/seed: URL database '${path_db}' != '${DB_NAME}'" >&2
    # Exit the script with the indicated status.
    exit 1
  # Close the if/elif/else conditional.
  fi
}

# Define helper function ensure_client.
ensure_client() {
  # Conditional branch for this shell guard.
  if [[ "${INSTALL_CLIENT}" -eq 1 ]]; then
    # Install required packages with elevated privileges.
    sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client
  # Close the if/elif/else conditional.
  fi
}

# Define helper function create_database.
create_database() {
  # Print status or error guidance for the operator.
  echo "Ensuring database ${DB_NAME} exists on ${PGHOST}:${PGPORT} (role ${PGUSER})"
  # Advance the P1 test-database preparation step.
  set +e
  # Configure OUT for this CI helper run.
  OUT="$(psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres -c "CREATE DATABASE ${DB_NAME} OWNER ${PGUSER};" 2>&1)"
  # Configure EC for this CI helper run.
  EC=$?
  # Fail fast on errors, unset vars, and pipe failures.
  set -e
  # Conditional branch for this shell guard.
  if [[ $EC -ne 0 ]]; then
    # Only PostgreSQL duplicate_database / "already exists" is treated as success.
    if echo "$OUT" | grep -qiE 'already exists|duplicate_database'; then
      # Print status or error guidance for the operator.
      echo "Database ${DB_NAME} already exists — continuing"
    # Fallback branch when earlier conditions were false.
    else
      # Print status or error guidance for the operator.
      echo "$OUT" >&2
      # Exit the script with the indicated status.
      exit 1
    # Close the if/elif/else conditional.
    fi
  # Close the if/elif/else conditional.
  fi
}

# Define helper function migrate.
migrate() {
  # Invoke the named helper for this phase.
  validate_target
  # Declare a function-scoped shell variable.
  local url="${DATABASE_URL_LIMITED}"
  # Conditional branch for this shell guard.
  if [[ "${MIGRATE_PLAIN}" -eq 1 ]]; then
    # Select migrate URL (plain vs connection_limit).
    url="${DATABASE_URL_PLAIN}"
  # Close the if/elif/else conditional.
  fi
  # Print status or error guidance for the operator.
  echo "Migrating ${DB_NAME}"
  # Run the next command from the target working directory.
  (cd "${API_DIR}" && DATABASE_URL="${url}" npx prisma migrate deploy)
}

# Define helper function seed.
seed() {
  # Invoke the named helper for this phase.
  validate_target
  # Dispatch on CLI argument / mode value.
  case "${SEED}" in
    # Advance the P1 test-database preparation step.
    none)
      # Print status or error guidance for the operator.
      echo "Skipping demo seed for ${DB_NAME}"
      # Advance the P1 test-database preparation step.
      ;;
    # Advance the P1 test-database preparation step.
    npm)
      # Print status or error guidance for the operator.
      echo "Seeding ${DB_NAME} via npm run db:seed"
      # Run the next command from the target working directory.
      (cd "${API_DIR}" && \
        # Configure DATABASE_URL for this CI helper run.
        DATABASE_URL="${DATABASE_URL_LIMITED}" \
        # Configure DEMO_SEED_DATABASE_NAME for this CI helper run.
        DEMO_SEED_DATABASE_NAME="${DB_NAME}" \
        # Invoke migrate/seed against the isolated P1 database.
        npm run db:seed)
      # Advance the P1 test-database preparation step.
      ;;
    # Advance the P1 test-database preparation step.
    register)
      # Print status or error guidance for the operator.
      echo "Seeding ${DB_NAME} via registerP1TestEnv.mjs"
      # Run the next command from the target working directory.
      (cd "${API_DIR}" && \
        # Configure DATABASE_URL for this CI helper run.
        DATABASE_URL="${DATABASE_URL_PLAIN}" \
        # Configure DEMO_SEED_DATABASE_NAME for this CI helper run.
        DEMO_SEED_DATABASE_NAME="${DB_NAME}" \
        # Invoke migrate/seed against the isolated P1 database.
        node --import ./tests/registerP1TestEnv.mjs --import tsx prisma/seed.ts)
      # Advance the P1 test-database preparation step.
      ;;
    # Advance the P1 test-database preparation step.
    *)
      # Print status or error guidance for the operator.
      echo "Invalid --seed=${SEED}" >&2
      # Exit the script with the indicated status.
      exit 2
      # Advance the P1 test-database preparation step.
      ;;
  # End the case dispatch block.
  esac
}

# Conditional branch for this shell guard.
if [[ "${ENV_ONLY}" -eq 1 ]]; then
  # Invoke the named helper for this phase.
  validate_target
  # Invoke the named helper for this phase.
  write_env
  # Exit the script with the indicated status.
  exit 0
# Close the if/elif/else conditional.
fi

# Invoke the named helper for this phase.
ensure_client
# Invoke the named helper for this phase.
create_database
# E2E writes .env before migrate/seed so registerP1TestEnv can load it.
if [[ "${SEED}" == "register" ]]; then
  # Invoke the named helper for this phase.
  write_env
  # Invoke the named helper for this phase.
  migrate
  # Invoke the named helper for this phase.
  seed
# Fallback branch when earlier conditions were false.
else
  # Invoke the named helper for this phase.
  migrate
  # Invoke the named helper for this phase.
  seed
  # Invoke the named helper for this phase.
  write_env
# Close the if/elif/else conditional.
fi
