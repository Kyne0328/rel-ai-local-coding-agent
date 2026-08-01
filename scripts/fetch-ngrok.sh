#!/usr/bin/env bash
# Validate the first-run ngrok acquisition path. Windows Authenticode verification
# requires the release command to run on a Windows host.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
node scripts/verify-ngrok-seed.mjs --download
