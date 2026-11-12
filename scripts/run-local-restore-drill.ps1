# Measured restore drill using Dockerized pg_* + age against a disposable DB.
# Does NOT touch production. Default source: maintenance_p1_test on Compose Postgres.
$ErrorActionPreference = "Stop"

# Assign a PowerShell variable used below.
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
# Assign a PowerShell variable used below.
$PgContainer = if ($env:PG_CONTAINER) { $env:PG_CONTAINER } else { "maintenance-db-1" }
# Assign a PowerShell variable used below.
$PgUser = if ($env:PG_USER) { $env:PG_USER } else { "maintenance" }
# Assign a PowerShell variable used below.
$SourceDb = if ($env:SOURCE_DB) { $env:SOURCE_DB } else { "maintenance_p1_test" }
# Assign a PowerShell variable used below.
$DrillDb = if ($env:DRILL_DB) { $env:DRILL_DB } else { "maintenance_restore_drill" }
# Assign a PowerShell variable used below.
$Work = if ($env:WORK_DIR) { $env:WORK_DIR } else { Join-Path $Root ".drill-backup" }
# Assign a PowerShell variable used below.
$AgeImage = if ($env:AGE_IMAGE) { $env:AGE_IMAGE } else { "alpine:3.20" }

# Invoke a PowerShell cmdlet for this step.
New-Item -ItemType Directory -Force -Path $Work | Out-Null

# Invoke a PowerShell cmdlet for this step.
Write-Host "== B2 restore drill =="
# Invoke a PowerShell cmdlet for this step.
Write-Host "source_db=$SourceDb drill_db=$DrillDb container=$PgContainer work=$Work"

# Run an external command needed by this step.
docker inspect $PgContainer | Out-Null

# Invoke a PowerShell cmdlet for this step.
Write-Host "-- generate ephemeral age identity"
# Run an external command needed by this step.
docker run --rm -v "${Work}:/work" -w /work $AgeImage `
  # Support the surrounding script logic for this step.
  sh -c "apk add --no-cache age >/dev/null && age-keygen -o /work/drill-age.key && age-keygen -y /work/drill-age.key > /work/drill-age.recipient"
# Assign a PowerShell variable used below.
$Recipient = (Get-Content (Join-Path $Work "drill-age.recipient") -Raw).Trim()
# Conditional branch for this guard.
if (-not $Recipient) { throw "age recipient missing" }

# Invoke a PowerShell cmdlet for this step.
Write-Host "-- create disposable database $DrillDb"
# Assign a PowerShell variable used below.
$createSql = @"
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = '$DrillDb' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS $DrillDb;
CREATE DATABASE $DrillDb OWNER $PgUser;
"@
# Assign a PowerShell variable used below.
$createSql | docker exec -i $PgContainer psql -U $PgUser -d postgres -v ON_ERROR_STOP=1 | Out-Null

# Invoke a PowerShell cmdlet for this step.
Write-Host "-- pg_dump $SourceDb (custom format)"
# Assign a PowerShell variable used below.
$t0 = Get-Date
# Run an external command needed by this step.
docker exec $PgContainer pg_dump -U $PgUser -d $SourceDb --format=custom --no-owner --no-acl -f /tmp/drill.dump
# Run an external command needed by this step.
docker cp "${PgContainer}:/tmp/drill.dump" (Join-Path $Work "drill.dump")
# Assign a PowerShell variable used below.
$dumpS = [int]((Get-Date) - $t0).TotalSeconds
# Invoke a PowerShell cmdlet for this step.
Write-Host "dump_seconds=$dumpS"

# Invoke a PowerShell cmdlet for this step.
Write-Host "-- age encrypt -> local file"
# Run an external command needed by this step.
docker run --rm -v "${Work}:/work" -w /work $AgeImage `
  # Support the surrounding script logic for this step.
  sh -c "apk add --no-cache age >/dev/null && age --recipient '$Recipient' -o /work/drill.dump.age /work/drill.dump"
# Invoke a PowerShell cmdlet for this step.
Remove-Item -Force (Join-Path $Work "drill.dump") -ErrorAction SilentlyContinue

# Invoke a PowerShell cmdlet for this step.
Write-Host "-- age decrypt + pg_restore into $DrillDb"
# Assign a PowerShell variable used below.
$t1 = Get-Date
# Run an external command needed by this step.
docker run --rm -v "${Work}:/work" -w /work $AgeImage `
  # Support the surrounding script logic for this step.
  sh -c "apk add --no-cache age >/dev/null && age --decrypt --identity /work/drill-age.key -o /work/drill.restored.dump /work/drill.dump.age"
# Run an external command needed by this step.
docker cp (Join-Path $Work "drill.restored.dump") "${PgContainer}:/tmp/drill.restored.dump"
# Run an external command needed by this step.
docker exec $PgContainer pg_restore -U $PgUser -d $DrillDb --clean --if-exists --no-owner --no-acl /tmp/drill.restored.dump
# Assign a PowerShell variable used below.
$restoreS = [int]((Get-Date) - $t1).TotalSeconds
# Invoke a PowerShell cmdlet for this step.
Write-Host "restore_seconds=$restoreS"

# Invoke a PowerShell cmdlet for this step.
Write-Host "-- verify gates (User + _prisma_migrations)"
# Assign a PowerShell variable used below.
$users = (docker exec $PgContainer psql -U $PgUser -d $DrillDb -Atc 'SELECT count(*) FROM "User"').Trim()
# Assign a PowerShell variable used below.
$migs = (docker exec $PgContainer psql -U $PgUser -d $DrillDb -Atc 'SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL').Trim()
# Invoke a PowerShell cmdlet for this step.
Write-Host "users=$users migrations=$migs"
# Conditional branch for this guard.
if ([int]$users -le 0) { throw "no User rows" }
# Conditional branch for this guard.
if ([int]$migs -le 0) { throw "no migration rows" }

# Assign a PowerShell variable used below.
$totalS = $dumpS + $restoreS
# Invoke a PowerShell cmdlet for this step.
Write-Host "-- RESULT pass dump_s=${dumpS}s restore_s=${restoreS}s wall_backup_plus_restore_s=${totalS}s"
# Invoke a PowerShell cmdlet for this step.
Write-Host "RPO_assumption=hourly_dump_not_15m_without_PITR"
# Invoke a PowerShell cmdlet for this step.
Write-Host "artifact=$(Join-Path $Work 'drill.dump.age')"

# Invoke a PowerShell cmdlet for this step.
Remove-Item -Force (Join-Path $Work "drill.restored.dump") -ErrorAction SilentlyContinue
# Run an external command needed by this step.
docker exec $PgContainer rm -f /tmp/drill.dump /tmp/drill.restored.dump | Out-Null

# Emit machine-readable summary for the audit doc
$utc = [DateTime]::UtcNow.ToString("o")
@"
drill_date_utc=$utc
source_db=$SourceDb
drill_db=$DrillDb
dump_seconds=$dumpS
restore_seconds=$restoreS
wall_backup_plus_restore_seconds=$totalS
users=$users
migrations=$migs
result=pass
rpo_note=Hourly dump schedule => RPO typically <60m (+ timer jitter); NOT 15m without PITR
rto_note=Measured restore wall clock ${restoreS}s on local Docker Postgres (not production host)
"@ | Set-Content -Encoding utf8 (Join-Path $Work "drill-result.env")
