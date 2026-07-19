// Packaging preflight: refuse to build an installer without the bundled ngrok seed.
//
// The seed binaries are gitignored (see vendor/ngrok/README.md), so a clean checkout
// has none. electron-builder happily packages a missing extraResources glob, which
// produced installers that threw "Bundled ngrok seed binary is missing." on first
// tunnel start. Fail here instead, while it is still cheap to fix.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SEEDS = {
  win32: 'ngrok.exe',
  darwin: 'ngrok',
  linux: 'ngrok'
};

// Packaging bundles only the build host's platform, so that is all we require.
const platform = process.env.REL_AI_TARGET_PLATFORM || process.platform;
const fileName = SEEDS[platform];

if (!fileName) {
  console.error(`[verify-ngrok-seed] Unsupported build platform: ${platform}. Expected one of ${Object.keys(SEEDS).join(', ')}.`);
  process.exit(1);
}

const seedPath = path.join(root, 'vendor', 'ngrok', platform, fileName);

if (!fs.existsSync(seedPath)) {
  const fetchCommand = process.platform === 'win32'
    ? 'pwsh scripts/fetch-ngrok.ps1'
    : 'scripts/fetch-ngrok.sh';
  console.error(`[verify-ngrok-seed] Missing ngrok seed binary for ${platform}: ${path.relative(root, seedPath)}`);
  console.error('[verify-ngrok-seed] Packaging without it produces an installer whose tunnel cannot start.');
  console.error(`[verify-ngrok-seed] Fetch it first:  NGROK_PLATFORMS=${platform} ${fetchCommand}`);
  process.exit(1);
}

const { size } = fs.statSync(seedPath);
// A real ngrok v3 agent is ~25 MB; anything tiny is a stub, an LFS pointer, or a
// truncated download that would fail at runtime rather than at build time.
const MIN_SEED_BYTES = 5 * 1024 * 1024;

if (size < MIN_SEED_BYTES) {
  console.error(`[verify-ngrok-seed] ${path.relative(root, seedPath)} is only ${(size / 1024 / 1024).toFixed(2)} MB.`);
  console.error('[verify-ngrok-seed] That is too small to be the real ngrok agent. Re-fetch the seed.');
  process.exit(1);
}

console.log(`[verify-ngrok-seed] OK: ${path.relative(root, seedPath)} (${(size / 1024 / 1024).toFixed(1)} MB).`);
