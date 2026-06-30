#!/usr/bin/env bash
# Fetch the ngrok seed binaries used by the Electron bundle.
#
# Downloads the official ngrok v3 stable agent for each platform and writes it to
# vendor/ngrok/<platform>/. These binaries are intentionally NOT committed to git
# (see vendor/ngrok/README.md); run this before packaging the Electron app.
#
# Usage:   scripts/fetch-ngrok.sh
#          NGROK_ARCH=arm64 scripts/fetch-ngrok.sh   # darwin/linux arm64
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
base="$repo_root/vendor/ngrok"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# darwin/linux default to amd64; override with NGROK_ARCH=arm64. Windows is always amd64.
arch="${NGROK_ARCH:-amd64}"

# plat:asset:out triples
targets=(
  "win32:windows-amd64:ngrok.exe"
  "darwin:darwin-${arch}:ngrok"
  "linux:linux-${arch}:ngrok"
)

for t in "${targets[@]}"; do
  IFS=':' read -r plat asset out <<<"$t"
  url="https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-${asset}.zip"
  zip="$tmp/${asset}.zip"
  echo "GET $url"
  curl -fsSL "$url" -o "$zip"
  ex="$tmp/$asset"
  mkdir -p "$ex"
  unzip -oq "$zip" -d "$ex"
  bin="$(find "$ex" -type f \( -name ngrok -o -name ngrok.exe \) | head -n1)"
  [ -n "$bin" ] || { echo "ngrok binary not found in $asset archive" >&2; exit 1; }
  dest_dir="$base/$plat"
  mkdir -p "$dest_dir"
  cp -f "$bin" "$dest_dir/$out"
  chmod +x "$dest_dir/$out" 2>/dev/null || true
  echo "  -> vendor/ngrok/$plat/$out"
done

echo 'ngrok seed binaries ready.'
