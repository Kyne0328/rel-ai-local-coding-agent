import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createReviewCheckpoint, replayReviewCheckpoint } from '../src/reviewCheckpoints.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-review-checkpoint-'));
const config = { stateDir: path.join(root, 'state') };
const workspace = { alias: 'app', path: path.join(root, 'repo') };
const otherWorkspace = { alias: 'other', path: path.join(root, 'other') };
fs.mkdirSync(workspace.path, { recursive: true });
fs.mkdirSync(otherWorkspace.path, { recursive: true });

try {
  const review = {
    ok: true,
    workspace: 'app',
    reviewScope: 'task',
    reviewHash: 'review-hash-a',
    reviewedFiles: ['src/app.js'],
    diff: 'diff --git a/src/app.js b/src/app.js\n+const value = 1;\n'
  };
  const checkpoint = createReviewCheckpoint(workspace, config, review);
  assert.match(checkpoint.checkpointId, /^review_[A-Za-z0-9_-]{24,160}$/);
  assert.match(checkpoint.payloadSha256, /^[a-f0-9]{64}$/);
  assert.equal(checkpoint.replayed, false);

  review.diff = 'mutated caller object';
  const replay = replayReviewCheckpoint(workspace, config, checkpoint.checkpointId);
  assert.equal(replay.replayed, true);
  assert.match(replay.diff, /const value = 1/);
  assert.equal(replay.reviewHash, 'review-hash-a');

  assert.throws(
    () => replayReviewCheckpoint(otherWorkspace, config, checkpoint.checkpointId),
    /different workspace|Unknown review checkpoint/i,
    'review checkpoints must not cross workspace boundaries'
  );

  const files = [];
  for (const directory of fs.readdirSync(path.join(config.stateDir, 'review-checkpoints'))) {
    const dir = path.join(config.stateDir, 'review-checkpoints', directory);
    for (const file of fs.readdirSync(dir)) files.push(path.join(dir, file));
  }
  assert.equal(files.length, 1);
  const stored = JSON.parse(fs.readFileSync(files[0], 'utf8'));
  stored.payload.diff = 'tampered';
  fs.writeFileSync(files[0], JSON.stringify(stored));
  assert.throws(
    () => replayReviewCheckpoint(workspace, config, checkpoint.checkpointId),
    /integrity check/i,
    'replay must reject a modified stored payload'
  );

  console.log('Immutable review checkpoint replay, workspace isolation, and integrity tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
