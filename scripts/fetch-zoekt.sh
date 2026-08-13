#!/usr/bin/env bash
# Build the exact Linux or macOS Zoekt binaries declared in vendor/zoekt/manifest.json.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
base="$repo_root/vendor/zoekt"
manifest="$base/manifest.json"
go_version="$(node -p "require('$manifest').toolchain.goVersion")"
commit="$(node -p "require('$manifest').upstream.commit")"
repo="$(node -p "require('$manifest').upstream.repository")"

host_os="$(uname -s)"
default_platform="linux"
[[ "$host_os" == "Darwin" ]] && default_platform="darwin"
target_platform="${ZOEKT_PLATFORMS:-$default_platform}"
if [[ "$target_platform" != "linux" && "$target_platform" != "darwin" ]]; then
  echo 'fetch-zoekt.sh supports one target: ZOEKT_PLATFORMS=linux or darwin.' >&2
  exit 1
fi

normalize_arch() {
  case "$1" in
    x64|X64|amd64|AMD64|x86_64|X86_64) echo x64 ;;
    arm64|ARM64|aarch64|AARCH64) echo arm64 ;;
    *) echo "Unsupported architecture: $1" >&2; exit 1 ;;
  esac
}

target_arch="$(normalize_arch "${REL_AI_TARGET_ARCH:-$(uname -m)}")"
if [[ "$target_platform" == "linux" && "$target_arch" != "x64" ]]; then
  echo 'Rel.AI Linux Zoekt packaging currently supports x64 only.' >&2
  exit 1
fi

manifest_value() {
  local expression="$1"
  node -p "const m=require('$manifest'); $expression"
}

target_spec="m.platforms['$target_platform'].architectures?.['$target_arch'] || m.platforms['$target_platform']"
go_arch="$(manifest_value "($target_spec).architecture")"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}

file_size() {
  if [[ "$host_os" == "Darwin" ]]; then stat -f '%z' "$1"; else stat -c '%s' "$1"; fi
}

resolve_go() {
  if command -v go >/dev/null 2>&1 && go version | grep -q "^go version go${go_version} "; then
    command -v go
    return
  fi
  local toolchain_key
  if [[ "$host_os" == "Darwin" ]]; then
    case "$(normalize_arch "$(uname -m)")" in
      x64) toolchain_key=darwinAmd64 ;;
      arm64) toolchain_key=darwinArm64 ;;
    esac
  else
    toolchain_key=linuxAmd64
  fi
  local url sha tool_root go_bin archive actual
  url="$(manifest_value "m.toolchain.$toolchain_key.url")"
  sha="$(manifest_value "m.toolchain.$toolchain_key.sha256")"
  tool_root="${TMPDIR:-/tmp}/relai-go-${go_version}-${toolchain_key}"
  go_bin="$tool_root/go/bin/go"
  if [[ -x "$go_bin" ]]; then echo "$go_bin"; return; fi
  archive="${TMPDIR:-/tmp}/relai-go-${go_version}-${toolchain_key}.tar.gz"
  if [[ ! -f "$archive" ]]; then
    echo "GET $url" >&2
    curl -fsSL "$url" -o "$archive"
  fi
  actual="$(sha256_file "$archive")"
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
  expected_size="$(manifest_value "($target_spec).$key.size")"
  expected_sha="$(manifest_value "($target_spec).$key.sha256")"
  actual_size="$(file_size "$file")"
  actual_sha="$(sha256_file "$file")"
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

export GOTOOLCHAIN=local CGO_ENABLED=0
export GOOS="$target_platform" GOARCH="$go_arch"
search_name="$(manifest_value "($target_spec).search.file")"
index_name="$(manifest_value "($target_spec).index.file")"
(
  cd "$source_root"
  "$go_bin" build -trimpath -ldflags='-s -w -buildid=' -o "$tmp/$search_name" ./cmd/zoekt
  "$go_bin" build -trimpath -ldflags='-s -w -buildid=' -o "$tmp/$index_name" ./cmd/zoekt-index
)
assert_artifact "$tmp/$search_name" search
assert_artifact "$tmp/$index_name" index
mkdir -p "$base/$target_platform"
cp -f "$tmp/$search_name" "$base/$target_platform/$search_name"
cp -f "$tmp/$index_name" "$base/$target_platform/$index_name"
chmod +x "$base/$target_platform/$search_name" "$base/$target_platform/$index_name"
echo "Zoekt $target_platform/$target_arch binaries verified from $commit."
