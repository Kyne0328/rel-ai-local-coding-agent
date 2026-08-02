import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCurrentUnpacked } from './current-unpacked.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const explicit = String(process.argv[2] || '').trim();
const executable = explicit
  ? path.resolve(root, explicit)
  : path.join(resolveCurrentUnpacked(root, { allowBuildCheck: true }), 'Rel.AI MCP.exe');
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
