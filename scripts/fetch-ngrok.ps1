# Fetch the ngrok seed binaries used by the Electron bundle.
#
# Downloads the official ngrok v3 stable agent for each platform and writes it to
# vendor/ngrok/<platform>/. These binaries are intentionally NOT committed to git
# (see vendor/ngrok/README.md); run this before packaging the Electron app.
#
# Usage:   pwsh scripts/fetch-ngrok.ps1
#          $env:NGROK_ARCH='arm64'; pwsh scripts/fetch-ngrok.ps1   # darwin/linux arm64
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$base = Join-Path $repoRoot 'vendor/ngrok'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "ngrok-seed-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force $tmp | Out-Null

# darwin/linux default to amd64; override with NGROK_ARCH=arm64. Windows is always amd64.
$arch = if ($env:NGROK_ARCH) { $env:NGROK_ARCH } else { 'amd64' }

$targets = @(
  @{ plat = 'win32';  asset = 'windows-amd64'; out = 'ngrok.exe' },
  @{ plat = 'darwin'; asset = "darwin-$arch";  out = 'ngrok' },
  @{ plat = 'linux';  asset = "linux-$arch";   out = 'ngrok' }
)

foreach ($t in $targets) {
  $url = "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-$($t.asset).zip"
  $zip = Join-Path $tmp "$($t.asset).zip"
  Write-Host "GET $url"
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  $ex = Join-Path $tmp $t.asset
  New-Item -ItemType Directory -Force $ex | Out-Null
  Expand-Archive -Path $zip -DestinationPath $ex -Force
  $bin = Get-ChildItem -Path $ex -Recurse -File | Where-Object { $_.Name -in 'ngrok', 'ngrok.exe' } | Select-Object -First 1
  if (-not $bin) { throw "ngrok binary not found in $($t.asset) archive" }
  $destDir = Join-Path $base $t.plat
  New-Item -ItemType Directory -Force $destDir | Out-Null
  $dest = Join-Path $destDir $t.out
  Copy-Item $bin.FullName $dest -Force
  $mb = [math]::Round((Get-Item $dest).Length / 1MB, 1)
  Write-Host "  -> vendor/ngrok/$($t.plat)/$($t.out)  ($mb MB)"
}

Remove-Item -Recurse -Force $tmp
Write-Host 'ngrok seed binaries ready.'
