# Build the exact Zoekt binaries declared in vendor/zoekt/manifest.json.
# Binaries are intentionally ignored by Git and are rebuilt from pinned source.
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$base = Join-Path $repoRoot 'vendor/zoekt'
$manifestPath = Join-Path $base 'manifest.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$goVersion = [string]$manifest.toolchain.goVersion
$commit = [string]$manifest.upstream.commit

$wanted = if ($env:ZOEKT_PLATFORMS) {
  @($env:ZOEKT_PLATFORMS.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
} else {
  @('win32')
}
foreach ($platform in $wanted) {
  if ($platform -notin @('win32', 'linux')) { throw "Unsupported ZOEKT_PLATFORMS value: $platform" }
}

function Get-GoExecutable {
  $installed = Get-Command go -ErrorAction SilentlyContinue
  if ($installed) {
    $versionText = (& $installed.Source version 2>&1 | Out-String).Trim()
    if ($versionText -match "^go version go$([regex]::Escape($goVersion)) ") { return $installed.Source }
  }

  $toolRoot = Join-Path ([System.IO.Path]::GetTempPath()) "relai-go-$goVersion"
  $goExe = Join-Path $toolRoot 'go/bin/go.exe'
  if (Test-Path $goExe -PathType Leaf) { return $goExe }

  $spec = $manifest.toolchain.windowsAmd64
  $archive = Join-Path ([System.IO.Path]::GetTempPath()) "relai-go-$goVersion-windows-amd64.zip"
  if (-not (Test-Path $archive -PathType Leaf)) {
    Write-Host "GET $($spec.url)"
    curl.exe -L --fail --silent --show-error ([string]$spec.url) -o $archive
    if ($LASTEXITCODE -ne 0) { throw "Could not download Go $goVersion." }
  }
  $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne [string]$spec.sha256) { throw "Go archive SHA-256 mismatch. Expected $($spec.sha256), got $hash." }
  if (Test-Path $toolRoot) { cmd /c rmdir /s /q "$toolRoot" | Out-Null }
  New-Item -ItemType Directory -Force $toolRoot | Out-Null
  tar.exe -xf $archive -C $toolRoot
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $goExe -PathType Leaf)) { throw "Could not extract Go $goVersion." }
  return $goExe
}

function Apply-RelAiPatch([string]$sourceRoot) {
  $builder = Join-Path $sourceRoot 'index/builder.go'
  $text = [IO.File]::ReadAllText($builder)
  $text = [regex]::Replace($text, '(?m)^\s*"golang\.org/x/sys/unix"\r?\n', '')
  $pattern = '(?s)// umask holds the Umask of the current process\r?\nvar umask os\.FileMode\r?\n\r?\nfunc init\(\) \{\r?\n\s*umask = os\.FileMode\(unix\.Umask\(0\)\)\r?\n\s*unix\.Umask\(int\(umask\)\)\r?\n\}'
  $replacement = "// umask holds the Umask of the current process.`nvar umask = platformUmask()"
  $updated = [regex]::Replace($text, $pattern, $replacement)
  if ($updated -eq $text) { throw 'Pinned Zoekt umask source no longer matches the reviewed Rel.AI compatibility patch.' }
  [IO.File]::WriteAllText($builder, $updated, [Text.UTF8Encoding]::new($false))
  Copy-Item (Join-Path $base 'patches/umask_windows.go') (Join-Path $sourceRoot 'index/relai_umask_windows.go') -Force
  Copy-Item (Join-Path $base 'patches/umask_unix.go') (Join-Path $sourceRoot 'index/relai_umask_unix.go') -Force
  Copy-Item (Join-Path $base 'patches/indexfile_windows.go') (Join-Path $sourceRoot 'index/indexfile_windows.go') -Force
}

function Assert-Artifact([string]$file, $spec) {
  $item = Get-Item -LiteralPath $file
  if ($item.Length -ne [int64]$spec.size) { throw "$($item.Name) size mismatch. Expected $($spec.size), got $($item.Length)." }
  $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne [string]$spec.sha256) { throw "$($item.Name) SHA-256 mismatch. Expected $($spec.sha256), got $hash." }
}

$go = Get-GoExecutable
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "relai-zoekt-$([guid]::NewGuid().ToString('N'))"
$sourceRoot = Join-Path $tmp 'source'
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  git clone --depth 1 --no-tags --quiet ([string]$manifest.upstream.repository) $sourceRoot
  if ($LASTEXITCODE -ne 0) { throw 'Could not clone Zoekt.' }
  git -C $sourceRoot fetch --depth 1 --quiet origin $commit
  if ($LASTEXITCODE -ne 0) { throw "Could not fetch pinned Zoekt commit $commit." }
  git -C $sourceRoot checkout --quiet FETCH_HEAD
  if ($LASTEXITCODE -ne 0) { throw "Could not checkout pinned Zoekt commit $commit." }
  $resolvedCommit = (git -C $sourceRoot rev-parse HEAD).Trim()
  if ($resolvedCommit -ne $commit) { throw "Zoekt commit mismatch. Expected $commit, got $resolvedCommit." }
  Apply-RelAiPatch $sourceRoot

  $env:GOTOOLCHAIN = 'local'
  $env:CGO_ENABLED = '0'
  $env:GOARCH = 'amd64'
  foreach ($platform in $wanted) {
    $spec = $manifest.platforms.$platform
    $env:GOOS = if ($platform -eq 'win32') { 'windows' } else { 'linux' }
    $searchOut = Join-Path $tmp ([string]$spec.search.file)
    $indexOut = Join-Path $tmp ([string]$spec.index.file)
    Push-Location $sourceRoot
    try {
      & $go build -trimpath '-ldflags=-s -w -buildid=' -o $searchOut ./cmd/zoekt
      if ($LASTEXITCODE -ne 0) { throw "Zoekt search build failed for $platform." }
      & $go build -trimpath '-ldflags=-s -w -buildid=' -o $indexOut ./cmd/zoekt-index
      if ($LASTEXITCODE -ne 0) { throw "Zoekt index build failed for $platform." }
    } finally { Pop-Location }
    Assert-Artifact $searchOut $spec.search
    Assert-Artifact $indexOut $spec.index
    $destination = Join-Path $base $platform
    New-Item -ItemType Directory -Force $destination | Out-Null
    Copy-Item $searchOut (Join-Path $destination ([string]$spec.search.file)) -Force
    Copy-Item $indexOut (Join-Path $destination ([string]$spec.index.file)) -Force
    Write-Host "Zoekt $platform binaries verified from $commit."
  }
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}