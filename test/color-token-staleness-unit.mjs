import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedPath = path.join(root, 'public', 'oauth.css');
const generator = path.join(root, 'scripts', 'generate-color-tokens.mjs');
const original = fs.readFileSync(generatedPath, 'utf8');

function run(...args) {
  return spawnSync(process.execPath, [generator, ...args], {
    cwd: root,
    encoding: 'utf8'
  });
}

try {
  assert.equal(run('--check').status, 0, 'fresh generated color assets must pass verification');
  fs.writeFileSync(generatedPath, `${original}\n/* intentional stale-asset probe */\n`, 'utf8');
  const stale = run('--check');
  assert.notEqual(stale.status, 0, 'stale generated color assets must fail verification');
  assert.match(`${stale.stdout}\n${stale.stderr}`, /public\/oauth\.css/);

  const regenerated = run();
  assert.equal(regenerated.status, 0, regenerated.stderr || regenerated.stdout);
  assert.equal(fs.readFileSync(generatedPath, 'utf8'), original, 'the generator must restore the canonical asset exactly');
  assert.equal(run('--check').status, 0, 'verification must pass after regeneration');
} finally {
  fs.writeFileSync(generatedPath, original, 'utf8');
}

console.log('Generated color-asset staleness detection and repair tests passed.');
