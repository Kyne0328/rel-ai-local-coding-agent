import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checker = path.join(root, 'scripts', 'check-generated.mjs');
const dashboardCss = path.join(root, 'public', 'dashboard.css');
const original = fs.readFileSync(dashboardCss);

function runCheck() {
  return spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
}

try {
  const fresh = runCheck();
  assert.equal(fresh.status, 0, fresh.stderr || fresh.stdout);
  assert.deepEqual(fs.readFileSync(dashboardCss), original, 'verification must not rewrite a fresh generated dashboard asset');

  const staleBytes = Buffer.concat([original, Buffer.from('\n/* intentional stale dashboard probe */\n')]);
  fs.writeFileSync(dashboardCss, staleBytes);
  const stale = runCheck();
  assert.notEqual(stale.status, 0, 'stale dashboard CSS must fail generated-asset verification');
  assert.match(`${stale.stdout}\n${stale.stderr}`, /Generated dashboard CSS is stale/i);
  assert.deepEqual(fs.readFileSync(dashboardCss), staleBytes, 'verification must report staleness without repairing or replacing the tracked file');
} finally {
  fs.writeFileSync(dashboardCss, original);
}

console.log('Generated dashboard verification is deterministic and non-destructive.');
