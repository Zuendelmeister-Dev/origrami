# Seeds two disposable Matrix test users on a running local Synapse instance.
# Credentials are intentionally weak. NEVER use these on a public server.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

foreach ($user in @('alice', 'bob')) {
    Write-Host "Creating local test user: $user" -ForegroundColor Yellow
    & docker compose exec -T synapse register_new_matrix_user `
        --user $user `
        --password $user `
        --no-admin `
        --exists-ok `
        --config /data/homeserver.yaml `
        http://localhost:8008
    if ($LASTEXITCODE -ne 0) {
        throw "Could not create '$user'. Inspect the server and preserve existing data; reset only disposable test installations."
    }
}
Write-Host 'Ready: alice/alice and bob/bob (Matrix IDs @alice:localhost, @bob:localhost). Existing accounts/passwords are unchanged.' -ForegroundColor Green
