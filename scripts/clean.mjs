import fs from 'node:fs';
import path from 'node:path';
import { assertSafeControllerOperation } from './active-controller-guard.mjs';

const root = path.resolve(import.meta.dirname, '..');
const mode = process.argv.includes('--release') ? 'release' : process.argv.includes('--electron') ? 'electron' : 'default';
const targets = mode === 'release'
  ? ['dist']
  : mode === 'electron'
    ? ['dist/build-check']
    : ['dist/build-check'];

const absoluteTargets = targets.map(target => path.join(root, target));
assertSafeControllerOperation({ operation: 'clean', targetPaths: absoluteTargets });

for (const target of targets) {
  const absolute = path.join(root, target);
  try {
    fs.rmSync(absolute, {
      recursive: true,
      force: true,
      maxRetries: process.platform === 'win32' ? 10 : 2,
      retryDelay: 250
    });
  } catch (error) {
    throw new Error(`Could not remove ${target} after bounded filesystem-lock retries. Close any Explorer window or external scanner holding the build directory, then retry.`, { cause: error });
  }
  console.log(`Removed ${target}`);
}
