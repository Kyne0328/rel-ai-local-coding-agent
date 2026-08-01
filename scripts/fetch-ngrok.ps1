# Validate the real first-run ngrok acquisition path without storing ngrok in the repository.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  & node scripts/verify-ngrok-seed.mjs --download
  if ($LASTEXITCODE -ne 0) { throw "Verified ngrok acquisition failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}
