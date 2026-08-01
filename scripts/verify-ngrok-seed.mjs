import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'vendor', 'ngrok', 'manifest.json');

function fail(message) {
  console.error(`[verify-ngrok-seed] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) fail(`Missing provenance manifest: ${path.relative(root, manifestPath)}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const platform = process.env.REL_AI_TARGET_PLATFORM || process.platform;
const spec = manifest.platforms?.[platform];
if (!spec) fail(`Unsupported build platform: ${platform}. Expected one of ${Object.keys(manifest.platforms || {}).join(', ')}.`);

const seedPath = path.join(root, 'vendor', 'ngrok', platform, spec.file);
if (!fs.existsSync(seedPath)) {
  const fetchCommand = process.platform === 'win32' ? 'pwsh scripts/fetch-ngrok.ps1' : 'scripts/fetch-ngrok.sh';
  fail(`Missing ngrok seed for ${platform}: ${path.relative(root, seedPath)}. Fetch it first with NGROK_PLATFORMS=${platform} ${fetchCommand}`);
}

const bytes = fs.readFileSync(seedPath);
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
if (bytes.length !== Number(spec.size)) fail(`${path.relative(root, seedPath)} size mismatch: expected ${spec.size}, got ${bytes.length}.`);
if (sha256 !== String(spec.sha256).toLowerCase()) fail(`${path.relative(root, seedPath)} SHA-256 mismatch: expected ${spec.sha256}, got ${sha256}.`);

if (platform === 'win32') {
  if (process.platform !== 'win32') fail('Windows Authenticode verification requires a Windows build host.');

  const version = spawnSync(seedPath, ['version'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  if (version.status !== 0) fail(`Could not read ngrok version: ${version.stderr || version.error?.message || `exit ${version.status}`}`);
  const versionText = `${version.stdout || ''}${version.stderr || ''}`.trim();
  if (versionText !== `ngrok version ${manifest.version}`) fail(`Version mismatch: expected ${manifest.version}, got ${JSON.stringify(versionText)}.`);

  const signatureScript = [
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:REL_AI_NGROK_PATH",
    "$result = [pscustomobject]@{ status = [string]$signature.Status; subject = [string]$signature.SignerCertificate.Subject; issuer = [string]$signature.SignerCertificate.Issuer }",
    '$result | ConvertTo-Json -Compress'
  ].join('; ');
  const signature = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', signatureScript], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
    env: { ...process.env, REL_AI_NGROK_PATH: seedPath }
  });
  if (signature.status !== 0) fail(`Authenticode inspection failed: ${signature.stderr || signature.error?.message || `exit ${signature.status}`}`);
  let result;
  try {
    result = JSON.parse(signature.stdout);
  } catch {
    fail(`Authenticode inspection returned invalid JSON: ${signature.stdout}`);
  }
  if (result.status !== 'Valid') fail(`Authenticode signature is not valid: ${result.status}.`);
  const expectedPublisher = String(spec.authenticode?.publisher || '');
  const expectedIssuer = String(spec.authenticode?.issuer || '');
  if (!String(result.subject).toLowerCase().includes(expectedPublisher.toLowerCase())) fail(`Signer mismatch: expected publisher containing ${JSON.stringify(expectedPublisher)}, got ${JSON.stringify(result.subject)}.`);
  if (!String(result.issuer).toLowerCase().includes(expectedIssuer.toLowerCase())) fail(`Issuer mismatch: expected ${JSON.stringify(expectedIssuer)}, got ${JSON.stringify(result.issuer)}.`);
}

console.log(`[verify-ngrok-seed] OK: ngrok ${manifest.version} ${platform}/${spec.architecture}, ${bytes.length} bytes, sha256=${sha256}.`);
