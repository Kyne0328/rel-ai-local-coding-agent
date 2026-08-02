import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'verify-fuses.mjs'), 'utf8');

assert.match(source, /process\.argv\[2\]/, 'fuse wrapper must preserve an explicit release-workflow executable path');
assert.match(source, /allowBuildCheck: true/, 'local fuse verification must resolve the current unpacked or build-check package');
assert.match(source, /electron[\\', ]+scripts[\\', ]+verify-fuses\.js/, 'wrapper must delegate policy verification to the exact-binary verifier');

console.log('Electron fuse verification wrapper argument and current-build resolution contracts passed.');
