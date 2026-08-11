#!/usr/bin/env bash
# Build the exact Linux Zoekt binaries declared in vendor/zoekt/manifest.json.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
base="$repo_root/vendor/zoekt"
manifest="$base/manifest.json"
go_version="$(node -p "require('$manifest').toolchain.goVersion")"
commit="$(node -p "require('$manifest').upstream.commit")"
repo="$(node -p "require('$manifest').upstream.repository")"

if [[ "${ZOEKT_PLATFORMS:-linux}" != "linux" ]]; then
  echo 'fetch-zoekt.sh supports ZOEKT_PLATFORMS=linux only.' >&2
  exit 1
fi

resolve_go() {
  if command -v go >/dev/null 2>&1 && go version | grep -q "^go version go${go_version} "; then
    command -v go
    return
  fi
  local tool_root="${TMPDIR:-/tmp}/relai-go-${go_version}"
  local go_bin="$tool_root/go/bin/go"
  if [[ -x "$go_bin" ]]; then
    echo "$go_bin"
    return
  fi
  local url sha archive actual
  url="$(node -p "require('$manifest').toolchain.linuxAmd64.url")"
  sha="$(node -p "require('$manifest').toolchain.linuxAmd64.sha256")"
  archive="${TMPDIR:-/tmp}/relai-go-${go_version}-linux-amd64.tar.gz"
  if [[ ! -f "$archive" ]]; then
    echo "GET $url" >&2
    curl -fsSL "$url" -o "$archive"
  fi
  actual="$(sha256sum "$archive" | awk '{print $1}')"
  [[ "$actual" == "$sha" ]] || { echo "Go archive SHA-256 mismatch. Expected $sha, got $actual." >&2; exit 1; }
  rm -rf "$tool_root"
  mkdir -p "$tool_root"
  tar -xzf "$archive" -C "$tool_root"
  [[ -x "$go_bin" ]] || { echo "Could not extract Go $go_version." >&2; exit 1; }
  echo "$go_bin"
}

apply_patch() {
  local source_root="$1"
  SOURCE_ROOT="$source_root" BASE="$base" node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const sourceRoot = process.env.SOURCE_ROOT;
const base = process.env.BASE;
const builder = path.join(sourceRoot, 'index', 'builder.go');
let text = fs.readFileSync(builder, 'utf8');
text = text.replace(/^\s*"golang\.org\/x\/sys\/unix"\r?\n/m, '');
const pattern = /\/\/ umask holds the Umask of the current process\r?\nvar umask os\.FileMode\r?\n\r?\nfunc init\(\) \{\r?\n\s*umask = os\.FileMode\(unix\.Umask\(0\)\)\r?\n\s*unix\.Umask\(int\(umask\)\)\r?\n\}/s;
const updated = text.replace(pattern, '// umask holds the Umask of the current process.\nvar umask = platformUmask()');
if (updated === text) throw new Error('Pinned Zoekt umask source no longer matches the reviewed Rel.AI compatibility patch.');
fs.writeFileSync(builder, updated);
for (const file of ['umask_windows.go', 'umask_unix.go', 'indexfile_windows.go']) {
  fs.copyFileSync(path.join(base, 'patches', file), path.join(sourceRoot, 'index', file === 'indexfile_windows.go' ? file : `relai_${file}`));
}
NODE
}

assert_artifact() {
  local file="$1" key="$2"
  local expected_size expected_sha actual_size actual_sha
  expected_size="$(node -p "require('$manifest').platforms.linux.$key.size")"
  expected_sha="$(node -p "require('$manifest').platforms.linux.$key.sha256")"
  actual_size="$(stat -c '%s' "$file")"
  actual_sha="$(sha256sum "$file" | awk '{print $1}')"
  [[ "$actual_size" == "$expected_size" ]] || { echo "$(basename "$file") size mismatch. Expected $expected_size, got $actual_size." >&2; exit 1; }
  [[ "$actual_sha" == "$expected_sha" ]] || { echo "$(basename "$file") SHA-256 mismatch. Expected $expected_sha, got $actual_sha." >&2; exit 1; }
}

go_bin="$(resolve_go)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
source_root="$tmp/source"
git clone --depth 1 --no-tags --quiet "$repo" "$source_root"
git -C "$source_root" fetch --depth 1 --quiet origin "$commit"
git -C "$source_root" checkout --quiet FETCH_HEAD
[[ "$(git -C "$source_root" rev-parse HEAD)" == "$commit" ]] || { echo 'Zoekt commit mismatch.' >&2; exit 1; }
apply_patch "$source_root"

export GOTOOLCHAIN=local CGO_ENABLED=0 GOOS=linux GOARCH=amd64
search_name="$(node -p "require('$manifest').platforms.linux.search.file")"
index_name="$(node -p "require('$manifest').platforms.linux.index.file")"
(
  cd "$source_root"
  "$go_bin" build -trimpath -ldflags='-s -w -buildid=' -o "$tmp/$search_name" ./cmd/zoekt
  "$go_bin" build -trimpath -ldflags='-s -w -buildid=' -o "$tmp/$index_name" ./cmd/zoekt-index
)
assert_artifact "$tmp/$search_name" search
assert_artifact "$tmp/$index_name" index
mkdir -p "$base/linux"
cp -f "$tmp/$search_name" "$base/linux/$search_name"
cp -f "$tmp/$index_name" "$base/linux/$index_name"
chmod +x "$base/linux/$search_name" "$base/linux/$index_name"
echo "Zoekt linux binaries verified from $commit."