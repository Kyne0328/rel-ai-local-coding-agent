import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'tunnel-client', 'manifest.json'), 'utf8'));
const requested = (process.env.TUNNEL_CLIENT_PLATFORMS || process.platform).split(',').map(value => value.trim()).filter(Boolean);
const targetArch = normalizeArch(process.env.REL_AI_TARGET_ARCH || process.arch);

for (const platform of requested) {
  const spec = resolvePlatformSpec(platform, targetArch);
  if (!spec) throw new Error(`Unsupported tunnel-client platform/architecture: ${platform}/${targetArch}`);
  const file = path.join(root, 'vendor', 'tunnel-client', platform, spec.file);
  if (!fs.existsSync(file)) throw new Error(`OpenAI tunnel-client is missing for ${platform}/${targetArch}. Run npm run fetch:tunnel-client.`);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size !== spec.size) throw new Error(`OpenAI tunnel-client size mismatch for ${platform}/${targetArch}. Run npm run fetch:tunnel-client.`);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (hash !== spec.sha256) throw new Error(`OpenAI tunnel-client SHA-256 mismatch for ${platform}/${targetArch}.`);
  console.log(`Verified OpenAI tunnel-client ${manifest.version} for ${platform}/${targetArch}: ${hash}`);
}

function resolvePlatformSpec(platform, arch) {
  const platformSpec = manifest.platforms[platform];
  return platformSpec?.architectures?.[arch] || platformSpec;
}

function normalizeArch(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['x64', 'amd64', 'x86_64'].includes(normalized)) return 'x64';
  if (['arm64', 'aarch64'].includes(normalized)) return 'arm64';
  throw new Error(`Unsupported tunnel-client architecture: ${normalized || '(empty)'}`);
}
