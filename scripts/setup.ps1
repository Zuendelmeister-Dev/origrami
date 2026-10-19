# PowerShell 5.1+, local setup with a cryptographically random password.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env'
if (Test-Path $envPath) {
  Write-Host '.env already exists. It was NOT overwritten.'
  exit 0
}
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$secret = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
[System.IO.File]::WriteAllText($envPath, "ORIGRAMI_DB_PASSWORD=$secret`n", [System.Text.Encoding]::ASCII)
Write-Host 'Created a new .env with a unique local database password.'
