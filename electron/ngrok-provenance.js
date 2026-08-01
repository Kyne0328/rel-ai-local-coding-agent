import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const electronRoot = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_SCHEMA_VERSION = 2;
const TRUSTED_DISTRIBUTION_HOSTS = new Set(['bin.ngrok.com', 'bin.equinox.io']);

function manifestCandidates() {
  return [
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'ngrok', 'manifest.json') : '',
    path.join(electronRoot, '..', 'vendor', 'ngrok', 'manifest.json'),
    path.join(process.cwd(), 'vendor', 'ngrok', 'manifest.json')
  ].filter(Boolean);
}

function resolveNgrokManifestPath(explicitPath = '') {
  const candidates = explicitPath ? [path.resolve(explicitPath)] : manifestCandidates();
  const found = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!found) throw new Error('The ngrok acquisition manifest is missing. Reinstall Rel.AI MCP or repair the application package.');
  return found;
}

function readNgrokManifest(options = {}) {
  const manifestPath = resolveNgrokManifestPath(options.manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error('The ngrok acquisition manifest is not valid JSON.', { cause: error });
  }
  validateNgrokManifest(manifest);
  return { manifest, manifestPath };
}

function validateNgrokManifest(manifest) {
  if (manifest?.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported ngrok acquisition manifest schema: ${manifest?.schemaVersion ?? 'missing'}.`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))) {
    throw new Error('The ngrok acquisition manifest has an invalid version.');
  }
  const platforms = manifest.platforms;
  if (!platforms || typeof platforms !== 'object' || Object.keys(platforms).length === 0) {
    throw new Error('The ngrok acquisition manifest does not declare a platform.');
  }
  for (const [platform, spec] of Object.entries(platforms)) validatePlatformSpec(platform, spec);
  return manifest;
}

function validatePlatformSpec(platform, spec) {
  if (!spec || typeof spec !== 'object') throw new Error(`The ngrok ${platform} manifest entry is invalid.`);
  if (!String(spec.architecture || '').trim()) throw new Error(`The ngrok ${platform} architecture is missing.`);
  validateFileRecord(spec.archive, `ngrok ${platform} archive`, { requireUrl: true });
  validateFileRecord(spec.executable, `ngrok ${platform} executable`, { requireFile: true });
  if (platform === 'win32') {
    if (!String(spec.authenticode?.publisher || '').trim()) throw new Error('The ngrok Windows publisher is missing.');
    if (!String(spec.authenticode?.issuer || '').trim()) throw new Error('The ngrok Windows certificate issuer is missing.');
  }
}

function validateFileRecord(record, label, options = {}) {
  if (!record || typeof record !== 'object') throw new Error(`The ${label} record is missing.`);
  if (!Number.isSafeInteger(Number(record.size)) || Number(record.size) <= 0) throw new Error(`The ${label} size is invalid.`);
  if (!/^[a-f0-9]{64}$/i.test(String(record.sha256 || ''))) throw new Error(`The ${label} SHA-256 is invalid.`);
  if (options.requireFile && !String(record.file || '').trim()) throw new Error(`The ${label} filename is missing.`);
  if (options.requireUrl) {
    const url = new URL(String(record.url || ''));
    if (url.protocol !== 'https:' || !TRUSTED_DISTRIBUTION_HOSTS.has(url.hostname.toLowerCase())) {
      throw new Error(`The ${label} URL must use an approved ngrok HTTPS distribution host.`);
    }
    if (String(record.format || '').toLowerCase() !== 'zip') throw new Error(`The ${label} format must be zip.`);
  }
}

function ngrokSpecForCurrentPlatform(manifest, options = {}) {
  const platform = options.platform || process.platform;
  const architecture = options.architecture || process.arch;
  const spec = manifest.platforms?.[platform];
  if (!spec) throw new Error(`Rel.AI MCP does not support automatic ngrok acquisition on ${platform}.`);
  const accepted = new Set([String(spec.architecture).toLowerCase()]);
  if (String(spec.architecture).toLowerCase() === 'x64') accepted.add('amd64');
  if (String(spec.architecture).toLowerCase() === 'amd64') accepted.add('x64');
  if (!accepted.has(String(architecture).toLowerCase())) {
    throw new Error(`The ngrok package supports ${spec.architecture}, but this application is running on ${architecture}.`);
  }
  return spec;
}

function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verifyFileRecord(file, record, label) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${label} is missing.`);
  const bytes = fs.statSync(file).size;
  if (bytes !== Number(record.size)) throw new Error(`${label} size mismatch: expected ${record.size}, got ${bytes}.`);
  const sha256 = fileSha256(file);
  if (sha256 !== String(record.sha256).toLowerCase()) throw new Error(`${label} SHA-256 mismatch.`);
  return { file, bytes, sha256 };
}

function verifyNgrokArchive(file, spec) {
  return verifyFileRecord(file, spec.archive, 'Downloaded ngrok archive');
}

function verifyNgrokExecutable(file, manifest, spec, options = {}) {
  const integrity = verifyFileRecord(file, spec.executable, 'ngrok executable');
  const platform = options.platform || process.platform;
  let signature = null;
  if (platform === 'win32') {
    const inspectSignature = options.inspectSignature || inspectWindowsAuthenticode;
    signature = inspectSignature(file);
    if (signature.status !== 'Valid') throw new Error(`ngrok Authenticode signature is not valid: ${signature.status}.`);
    if (!String(signature.subject || '').toLowerCase().includes(String(spec.authenticode.publisher).toLowerCase())) {
      throw new Error(`ngrok publisher mismatch: ${signature.subject || 'missing certificate subject'}.`);
    }
    if (!String(signature.issuer || '').toLowerCase().includes(String(spec.authenticode.issuer).toLowerCase())) {
      throw new Error(`ngrok certificate issuer mismatch: ${signature.issuer || 'missing certificate issuer'}.`);
    }
  }
  const readVersion = options.readVersion || readNgrokVersion;
  const versionText = readVersion(file);
  if (versionText !== `ngrok version ${manifest.version}`) {
    throw new Error(`ngrok version mismatch: expected ${manifest.version}, got ${JSON.stringify(versionText)}.`);
  }
  return { ...integrity, version: manifest.version, signature };
}

function inspectWindowsAuthenticode(file) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$result = $null',
    'for ($attempt = 1; $attempt -le 5; $attempt += 1) {',
    '  $signature = Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $env:REL_AI_NGROK_PATH -ErrorAction Stop',
    '  $result = [pscustomobject]@{ status = [string]$signature.Status; statusMessage = [string]$signature.StatusMessage; subject = [string]$signature.SignerCertificate.Subject; issuer = [string]$signature.SignerCertificate.Issuer; attempt = $attempt }',
    '  if ($result.status -and $result.subject -and $result.issuer) { break }',
    '  Start-Sleep -Milliseconds 1000',
    '}',
    '$result | ConvertTo-Json -Compress'
  ].join('; ');
  const childEnvironment = { ...process.env, REL_AI_NGROK_PATH: file };
  for (const key of Object.keys(childEnvironment)) {
    if (key.toLowerCase() === 'psmodulepath') delete childEnvironment[key];
  }
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20_000,
    env: childEnvironment
  });
  if (result.status !== 0) throw new Error(`Could not inspect the ngrok Authenticode signature: ${result.stderr || result.error?.message || `exit ${result.status}`}`);
  try {
    const inspected = JSON.parse(result.stdout);
    if (!inspected.status) {
      throw new Error(`Windows returned an empty Authenticode status after ${inspected.attempt || 5} attempts${inspected.statusMessage ? `: ${inspected.statusMessage}` : ''}.`);
    }
    return inspected;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Windows returned an invalid ngrok signature result.', { cause: error });
    throw error;
  }
}

function readNgrokVersion(file) {
  const result = spawnSync(file, ['version'], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
  if (result.status !== 0) throw new Error(`Could not read the ngrok version: ${result.stderr || result.error?.message || `exit ${result.status}`}`);
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

export {
  MANIFEST_SCHEMA_VERSION,
  TRUSTED_DISTRIBUTION_HOSTS,
  fileSha256,
  inspectWindowsAuthenticode,
  manifestCandidates,
  ngrokSpecForCurrentPlatform,
  readNgrokManifest,
  readNgrokVersion,
  resolveNgrokManifestPath,
  validateNgrokManifest,
  verifyFileRecord,
  verifyNgrokArchive,
  verifyNgrokExecutable
};
