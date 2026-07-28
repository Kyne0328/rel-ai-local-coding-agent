import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const mode = process.argv.includes('--release') ? 'release' : process.argv.includes('--electron') ? 'electron' : 'default';
const targets = mode === 'release'
  ? ['dist']
  : mode === 'electron'
    ? ['dist/build-check']
    : ['dist/build-check'];

for (const target of targets) {
  const absolute = path.join(root, target);
  fs.rmSync(absolute, { recursive: true, force: true });
  console.log(`Removed ${target}`);
}
