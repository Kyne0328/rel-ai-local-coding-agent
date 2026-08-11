import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const run = spawnSync(process.execPath, ['scripts/benchmark-exec-phases.mjs', '--samples=2'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  timeout: 60000
});
assert.equal(run.status, 0, run.stderr || run.stdout);
const lines = String(run.stdout || '').trim().split(/\r?\n/).filter(Boolean);
const result = JSON.parse(lines.at(-1));
assert.equal(result.samples, 2);
for (const key of ['commandMs', 'relaiExecWallMs', 'callToolWallMs', 'executorOverheadMs', 'orchestrationOverheadMs']) {
  assert.equal(typeof result.medians?.[key], 'number', `${key} median missing`);
  assert.ok(result.medians[key] >= 0, `${key} median must be non-negative`);
}
assert.equal(typeof result.environment?.platform, 'string');
assert.equal(typeof result.environment?.node, 'string');
console.log('Exec phase benchmark emits machine-readable timing partitions.');