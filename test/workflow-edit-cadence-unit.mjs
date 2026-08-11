import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { postActionRecommendation } from '../src/executionPlanner.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-edit-cadence-'));
try {
  fs.mkdirSync(path.join(root, 'front-end', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'front-end', 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const workspace = { alias: 'repo', path: root };
  const docs = postActionRecommendation(workspace, ['README.md']);
  assert.equal(docs.runChecks, false);
  assert.equal(docs.returnDiff, true);
  const local = postActionRecommendation(workspace, ['front-end/src/app.js']);
  assert.equal(local.runChecks, true);
  assert.equal(local.returnDiff, true);
  assert.match(local.reason, /package|medium|source/i);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Risk-aware edit cadence recommendations passed.');