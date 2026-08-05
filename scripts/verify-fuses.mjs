import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { electronPlatformSpec, normalizeElectronPlatform } from './electron-platform.mjs';
import { resolveCurrentUnpacked } from './current-unpacked.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const platformIndex = args.indexOf('--platform');
if (platformIndex >= 0 && (!args[platformIndex + 1] || args[platformIndex + 1].startsWith('--'))) {
  throw new Error('--platform requires win32 or linux.');
}
const platform = normalizeElectronPlatform(platformIndex >= 0 ? args[platformIndex + 1] : process.platform);
if (platformIndex >= 0) args.splice(platformIndex, 2);
const spec = electronPlatformSpec(platform);
const explicit = String(args[0] || '').trim();
const executable = explicit
  ? path.resolve(root, explicit)
  : path.join(resolveCurrentUnpacked(root, { allowBuildCheck: true, platform }), spec.executableName);
const verifier = path.join(root, 'electron', 'scripts', 'verify-fuses.js');
const result = spawnSync(process.execPath, [verifier, executable], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true
});

if (result.error) throw new Error(`Electron fuse verifier could not start: ${result.error.message}`, { cause: result.error });
if (result.signal) throw new Error(`Electron fuse verifier was terminated by ${result.signal}.`);
if (result.status !== 0) process.exit(result.status || 1);
