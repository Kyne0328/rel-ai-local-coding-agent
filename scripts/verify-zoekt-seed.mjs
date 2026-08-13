import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'vendor', 'zoekt', 'manifest.json');

function fail(message) {
  console.error(`[verify-zoekt-seed] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) fail(`Missing provenance manifest: ${path.relative(root, manifestPath)}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const platform = process.env.REL_AI_TARGET_PLATFORM || process.platform;
const targetArch = normalizeArch(process.env.REL_AI_TARGET_ARCH || process.arch);
const platformSpec = manifest.platforms?.[platform];
const spec = platformSpec?.architectures?.[targetArch] || platformSpec;
if (!spec) fail(`Unsupported build platform/architecture: ${platform}/${targetArch}. Expected one of ${Object.keys(manifest.platforms || {}).join(', ')}.`);

for (const key of ['search', 'index']) {
  const artifact = spec[key];
  const file = path.join(root, 'vendor', 'zoekt', platform, artifact.file);
  if (!fs.existsSync(file)) {
    const command = process.platform === 'win32' ? 'pwsh scripts/fetch-zoekt.ps1' : 'bash scripts/fetch-zoekt.sh';
    fail(`Missing Zoekt ${key} binary for ${platform}/${targetArch}: ${path.relative(root, file)}. Build it first with ZOEKT_PLATFORMS=${platform} REL_AI_TARGET_ARCH=${targetArch} ${command}`);
  }
  const bytes = fs.readFileSync(file);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== Number(artifact.size)) fail(`${artifact.file} size mismatch: expected ${artifact.size}, got ${bytes.length}.`);
  if (sha256 !== String(artifact.sha256).toLowerCase()) fail(`${artifact.file} SHA-256 mismatch: expected ${artifact.sha256}, got ${sha256}.`);
  if (platform === process.platform && targetArch === normalizeArch(process.arch)) {
    const help = spawnSync(file, ['-h'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    if (help.error || help.status !== 0) fail(`${artifact.file} could not execute: ${help.error?.message || help.stderr || `exit ${help.status}`}`);
  }
  if (platform !== 'win32') {
    const mode = fs.statSync(file).mode;
    if ((mode & 0o111) === 0) fail(`${artifact.file} is not executable.`);
  }
}

console.log(`[verify-zoekt-seed] OK: Zoekt ${manifest.upstream.commit} ${platform}/${spec.architecture}, patch=${manifest.upstream.patchSet}.`);

function normalizeArch(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['x64', 'amd64', 'x86_64'].includes(normalized)) return 'x64';
  if (['arm64', 'aarch64'].includes(normalized)) return 'arm64';
  fail(`Unsupported architecture: ${normalized || '(empty)'}.`);
}
