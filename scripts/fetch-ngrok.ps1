# Fetch the exact ngrok seed binaries declared in vendor/ngrok/manifest.json.
#
# The stable download URL is intentionally paired with pinned size and SHA-256
# values. When ngrok publishes a new stable build, this script fails closed until
# the manifest is reviewed and updated.
#
# Usage:   pwsh scripts/fetch-ngrok.ps1
#          $env:NGROK_PLATFORMS='win32'; pwsh scripts/fetch-ngrok.ps1
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$base = Join-Path $repoRoot 'vendor/ngrok'
$manifestPath = Join-Path $base 'manifest.json'
if (-not (Test-Path $manifestPath -PathType Leaf)) {
  throw "ngrok provenance manifest is missing: $manifestPath"
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$platforms = @{}
foreach ($property in $manifest.platforms.PSObject.Properties) {
  $platforms[$property.Name] = $property.Value
}
if ($platforms.Count -eq 0) {
  throw 'ngrok provenance manifest does not declare any platforms.'
}

$wanted = if ($env:NGROK_PLATFORMS) {
  @($env:NGROK_PLATFORMS.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
} else {
  @($platforms.Keys | Sort-Object)
}
$unknown = @($wanted | Where-Object { -not $platforms.ContainsKey($_) })
if ($unknown.Count -gt 0) {
  throw "Unknown NGROK_PLATFORMS value(s): $($unknown -join ', '). Valid: $($platforms.Keys -join ', ')."
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "ngrok-seed-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force $tmp | Out-Null

try {
  foreach ($platform in $wanted) {
    $spec = $platforms[$platform]
    $zip = Join-Path $tmp "$($spec.asset).zip"
    Write-Host "GET $($spec.url)"
    Invoke-WebRequest -Uri $spec.url -OutFile $zip -UseBasicParsing

    $extractDir = Join-Path $tmp $spec.asset
    New-Item -ItemType Directory -Force $extractDir | Out-Null
    Expand-Archive -Path $zip -DestinationPath $extractDir -Force
    $binary = Get-ChildItem -Path $extractDir -Recurse -File | Where-Object { $_.Name -eq $spec.file } | Select-Object -First 1
    if (-not $binary) {
      throw "ngrok binary '$($spec.file)' was not found in $($spec.asset)."
    }

    if ($binary.Length -ne [int64]$spec.size) {
      throw "ngrok $platform size mismatch. Expected $($spec.size), got $($binary.Length). Update the reviewed manifest before accepting a new upstream build."
    }
    $hash = (Get-FileHash -LiteralPath $binary.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne [string]$spec.sha256) {
      throw "ngrok $platform SHA-256 mismatch. Expected $($spec.sha256), got $hash."
    }

    if ($platform -eq 'win32') {
      $signature = Get-AuthenticodeSignature -LiteralPath $binary.FullName
      if ($signature.Status -ne 'Valid') {
        throw "ngrok Windows Authenticode signature is not valid: $($signature.Status)."
      }
      $publisher = [string]$spec.authenticode.publisher
      $issuer = [string]$spec.authenticode.issuer
      if (-not $signature.SignerCertificate.Subject.Contains($publisher, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "ngrok Windows signer mismatch. Expected publisher containing '$publisher', got '$($signature.SignerCertificate.Subject)'."
      }
      if (-not $signature.SignerCertificate.Issuer.Contains($issuer, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "ngrok Windows certificate issuer mismatch. Expected '$issuer', got '$($signature.SignerCertificate.Issuer)'."
      }
      $versionText = (& $binary.FullName version 2>&1 | Out-String).Trim()
      if ($versionText -ne "ngrok version $($manifest.version)") {
        throw "ngrok Windows version mismatch. Expected $($manifest.version), got '$versionText'."
      }
    }

    $destDir = Join-Path $base $platform
    New-Item -ItemType Directory -Force $destDir | Out-Null
    $dest = Join-Path $destDir $spec.file
    Copy-Item $binary.FullName $dest -Force
    $mb = [math]::Round((Get-Item $dest).Length / 1MB, 1)
    Write-Host "  -> vendor/ngrok/$platform/$($spec.file) ($mb MB, sha256=$hash)"
  }
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

Write-Host "ngrok $($manifest.version) seed binaries verified and ready."
