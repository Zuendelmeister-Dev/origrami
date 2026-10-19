# DESTRUCTIVE local development reset: deletes database, media, keys and chat history.
# Usage: .\scripts\reset-and-seed.ps1
# Skip confirmation deliberately with: .\scripts\reset-and-seed.ps1 -Force
param([switch]$Force)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host 'WARNING: All existing Origrami Docker volumes for this Compose project will be deleted.' -ForegroundColor Yellow
Write-Host 'Users, rooms, chats, media and signing keys will be lost.' -ForegroundColor Yellow
if (-not $Force) {
    $answer = Read-Host 'To proceed, type RESET'
    if ($answer -cne 'RESET') { Write-Host 'Canceled.'; exit 0 }
}

# Generate the database password BEFORE parsing any Compose commands.
& (Join-Path $PSScriptRoot 'setup.ps1')
$envFile = Join-Path (Get-Location) '.env'
if (-not (Test-Path $envFile)) { throw 'Database password setup failed.' }
if (-not (Select-String -Path $envFile -Pattern '^ORIGRAMI_DB_PASSWORD=.+$' -Quiet)) {
    throw '.env does not contain ORIGRAMI_DB_PASSWORD.'
}
if (Select-String -Path $envFile -Pattern '^ORIGRAMI_DB_PASSWORD=REPLACE_WITH_A_LONG_RANDOM_PASSWORD\s*$' -Quiet) {
    throw 'Replace the placeholder database password before resetting.'
}
& docker compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Invalid Compose configuration. No data was deleted.' }

& docker compose down -v --remove-orphans
if ($LASTEXITCODE -ne 0) { throw 'docker compose down failed.' }

& docker compose up --build -d --wait --wait-timeout 180
if ($LASTEXITCODE -ne 0) { throw 'Compose startup failed. See docker compose logs synapse-init and synapse.' }

& (Join-Path $PSScriptRoot 'seed-users.ps1')
if ($LASTEXITCODE -ne 0) { throw 'User provisioning failed.' }

Write-Host 'Origrami is ready: http://localhost:5173' -ForegroundColor Green
