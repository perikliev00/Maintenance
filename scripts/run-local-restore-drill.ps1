# Measured restore drill using Dockerized pg_* + age against a disposable DB.
# Does NOT touch production. Default source: maintenance_p1_test on Compose Postgres.
$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$PgContainer = if ($env:PG_CONTAINER) { $env:PG_CONTAINER } else { "maintenance-db-1" }
$PgUser = if ($env:PG_USER) { $env:PG_USER } else { "maintenance" }
$SourceDb = if ($env:SOURCE_DB) { $env:SOURCE_DB } else { "maintenance_p1_test" }
$DrillDb = if ($env:DRILL_DB) { $env:DRILL_DB } else { "maintenance_restore_drill" }
$Work = if ($env:WORK_DIR) { $env:WORK_DIR } else { Join-Path $Root ".drill-backup" }
$AgeImage = if ($env:AGE_IMAGE) { $env:AGE_IMAGE } else { "alpine:3.20" }

New-Item -ItemType Directory -Force -Path $Work | Out-Null

Write-Host "== B2 restore drill =="
Write-Host "source_db=$SourceDb drill_db=$DrillDb container=$PgContainer work=$Work"

docker inspect $PgContainer | Out-Null

Write-Host "-- generate ephemeral age identity"
docker run --rm -v "${Work}:/work" -w /work $AgeImage `
  sh -c "apk add --no-cache age >/dev/null && age-keygen -o /work/drill-age.key && age-keygen -y /work/drill-age.key > /work/drill-age.recipient"
$Recipient = (Get-Content (Join-Path $Work "drill-age.recipient") -Raw).Trim()
if (-not $Recipient) { throw "age recipient missing" }

Write-Host "-- create disposable database $DrillDb"
$createSql = @"
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = '$DrillDb' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS $DrillDb;
CREATE DATABASE $DrillDb OWNER $PgUser;
"@
$createSql | docker exec -i $PgContainer psql -U $PgUser -d postgres -v ON_ERROR_STOP=1 | Out-Null

Write-Host "-- pg_dump $SourceDb (custom format)"
$t0 = Get-Date
docker exec $PgContainer pg_dump -U $PgUser -d $SourceDb --format=custom --no-owner --no-acl -f /tmp/drill.dump
docker cp "${PgContainer}:/tmp/drill.dump" (Join-Path $Work "drill.dump")
$dumpS = [int]((Get-Date) - $t0).TotalSeconds
Write-Host "dump_seconds=$dumpS"

Write-Host "-- age encrypt -> local file"
docker run --rm -v "${Work}:/work" -w /work $AgeImage `
  sh -c "apk add --no-cache age >/dev/null && age --recipient '$Recipient' -o /work/drill.dump.age /work/drill.dump"
Remove-Item -Force (Join-Path $Work "drill.dump") -ErrorAction SilentlyContinue

Write-Host "-- age decrypt + pg_restore into $DrillDb"
$t1 = Get-Date
docker run --rm -v "${Work}:/work" -w /work $AgeImage `
  sh -c "apk add --no-cache age >/dev/null && age --decrypt --identity /work/drill-age.key -o /work/drill.restored.dump /work/drill.dump.age"
docker cp (Join-Path $Work "drill.restored.dump") "${PgContainer}:/tmp/drill.restored.dump"
docker exec $PgContainer pg_restore -U $PgUser -d $DrillDb --clean --if-exists --no-owner --no-acl /tmp/drill.restored.dump
$restoreS = [int]((Get-Date) - $t1).TotalSeconds
Write-Host "restore_seconds=$restoreS"

Write-Host "-- verify gates (User + _prisma_migrations)"
$users = (docker exec $PgContainer psql -U $PgUser -d $DrillDb -Atc 'SELECT count(*) FROM "User"').Trim()
$migs = (docker exec $PgContainer psql -U $PgUser -d $DrillDb -Atc 'SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL').Trim()
Write-Host "users=$users migrations=$migs"
if ([int]$users -le 0) { throw "no User rows" }
if ([int]$migs -le 0) { throw "no migration rows" }

$totalS = $dumpS + $restoreS
Write-Host "-- RESULT pass dump_s=${dumpS}s restore_s=${restoreS}s wall_backup_plus_restore_s=${totalS}s"
Write-Host "RPO_assumption=hourly_dump_not_15m_without_PITR"
Write-Host "artifact=$(Join-Path $Work 'drill.dump.age')"

Remove-Item -Force (Join-Path $Work "drill.restored.dump") -ErrorAction SilentlyContinue
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
