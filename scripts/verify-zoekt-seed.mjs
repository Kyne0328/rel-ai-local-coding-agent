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
const spec = manifest.platforms?.[platform];
if (!spec) fail(`Unsupported build platform: ${platform}. Expected one of ${Object.keys(manifest.platforms || {}).join(', ')}.`);

for (const key of ['search', 'index']) {
  const artifact = spec[key];
  const file = path.join(root, 'vendor', 'zoekt', platform, artifact.file);
  if (!fs.existsSync(file)) {
    const command = process.platform === 'win32' ? 'pwsh scripts/fetch-zoekt.ps1' : 'bash scripts/fetch-zoekt.sh';
    fail(`Missing Zoekt ${key} binary for ${platform}: ${path.relative(root, file)}. Build it first with ZOEKT_PLATFORMS=${platform} ${command}`);
  }
  const bytes = fs.readFileSync(file);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== Number(artifact.size)) fail(`${artifact.file} size mismatch: expected ${artifact.size}, got ${bytes.length}.`);
  if (sha256 !== String(artifact.sha256).toLowerCase()) fail(`${artifact.file} SHA-256 mismatch: expected ${artifact.sha256}, got ${sha256}.`);
  if (platform === process.platform) {
    const help = spawnSync(file, ['-h'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    if (help.error || help.status !== 0) fail(`${artifact.file} could not execute: ${help.error?.message || help.stderr || `exit ${help.status}`}`);
  }
  if (platform === 'linux') {
    const mode = fs.statSync(file).mode;
    if ((mode & 0o111) === 0) fail(`${artifact.file} is not executable.`);
  }
}

console.log(`[verify-zoekt-seed] OK: Zoekt ${manifest.upstream.commit} ${platform}/${spec.architecture}, patch=${manifest.upstream.patchSet}.`);