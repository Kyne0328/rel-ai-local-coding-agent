import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { relaiDiff } from "../src/bridge/review.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-redacted-review-'));
const git = (args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
const workspace = { alias: 'repo', path: root };
const config = { stateDir: path.join(root, '.state') };
const removeRoot = () => {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (error) {
    if (process.platform !== 'win32' || !['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) throw error;
  }
};
try {
  git(['init']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Rel AI Test']);
  fs.writeFileSync(path.join(root, '.env'), 'API_KEY=old-secret\nPORT=3000\nREMOVE_ME=gone\n');
  fs.writeFileSync(path.join(root, 'app.js'), 'console.log("old");\n');
  git(['add', '-f', '.env', 'app.js']);
  git(['commit', '-m', 'base']);

  fs.writeFileSync(path.join(root, '.env'), 'API_KEY=new-secret\nPORT=3000\nADDED=value\ninvalid line\n');
  fs.writeFileSync(path.join(root, 'app.js'), 'console.log("new");\n');

  await assert.rejects(() => relaiDiff(workspace, config, { path: '.env' }), /redactSensitive:true|blocked sensitive path/);

  const review = await relaiDiff(workspace, config, { redactSensitive: true });
  assert.match(review.diff, /console\.log\("new"\)/);
  assert.doesNotMatch(review.diff, /old-secret|new-secret|API_KEY|REMOVE_ME|ADDED/);
  assert.equal(review.sensitiveValuesReturned, false);
  const env = review.sensitiveReview.find((item) => item.path === '.env');
  assert.deepEqual(env.addedKeys, ['ADDED']);
  assert.deepEqual(env.removedKeys, ['REMOVE_ME']);
  assert.deepEqual(env.changedKeys, ['API_KEY']);
  assert.deepEqual(env.malformedLinesAfter, [4]);
  assert.doesNotMatch(JSON.stringify(review), /old-secret|new-secret|=value|=3000/);

  git(['add', '-f', '.env']);
  const staged = await relaiDiff(workspace, config, { staged: true, path: '.env', redactSensitive: true });
  assert.equal(staged.diff, '');
  assert.deepEqual(staged.sensitiveReview[0].changedKeys, ['API_KEY']);
  assert.doesNotMatch(JSON.stringify(staged), /old-secret|new-secret/);

  console.log('Redacted sensitive review passed without value disclosure.');
} finally {
  removeRoot();
}
