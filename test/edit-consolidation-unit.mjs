import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { planEdit } from "../src/executionPlanner.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-edit-consolidation-'));
const workspace = { alias: 'repo', path: root };
const config = { stateDir: path.join(root, '.state') };
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

try {
  fs.writeFileSync(path.join(root, 'duplicate.txt'), 'item\nitem\nitem\n');
  const occurrence = await planEdit(workspace, config, {
    path: 'duplicate.txt',
    oldText: 'item',
    newText: 'selected',
    occurrence: 2
  });
  assert.equal(occurrence.ok, true);
  assert.equal(occurrence.deprecated, undefined, 'primary edit results must not carry compatibility metadata');
  assert.equal(fs.readFileSync(path.join(root, 'duplicate.txt'), 'utf8'), 'item\nselected\nitem\n');

  fs.writeFileSync(path.join(root, 'multi.txt'), 'alpha beta gamma\n');
  const multi = await planEdit(workspace, config, {
    path: 'multi.txt',
    expectedSha256: sha('alpha beta gamma\n'),
    replacements: [
      { oldText: 'alpha', newText: 'one' },
      { oldText: 'gamma', newText: 'three' }
    ]
  });
  assert.equal(multi.ok, true);
  assert.equal(multi.replacements.length, 2);
  assert.equal(fs.readFileSync(path.join(root, 'multi.txt'), 'utf8'), 'one beta three\n');

  fs.writeFileSync(path.join(root, 'batch.txt'), 'left middle right\n');
  const batch = await planEdit(workspace, config, {
    edits: [{
      path: 'batch.txt',
      replacements: [
        { oldText: 'left', newText: 'L' },
        { oldText: 'right', newText: 'R' }
      ]
    }]
  });
  assert.equal(batch.ok, true);
  assert.equal(batch.appliedCount, 1);
  assert.equal(fs.readFileSync(path.join(root, 'batch.txt'), 'utf8'), 'L middle R\n');

  const stagedStart = await planEdit(workspace, config, {
    stage: 'start',
    path: 'staged.txt',
    content: 'chunk-one\n'
  });
  assert.equal(stagedStart.plannerPath, 'write:staged');
  assert.equal(stagedStart.deprecated, undefined);
  await planEdit(workspace, config, {
    stage: 'append',
    writeId: stagedStart.writeId,
    content: 'chunk-two\n'
  });
  const stagedCommit = await planEdit(workspace, config, {
    stage: 'commit',
    writeId: stagedStart.writeId
  });
  assert.equal(stagedCommit.ok, true);
  assert.equal(stagedCommit.plannerPath, 'write:staged');
  assert.equal(stagedCommit.deprecated, undefined);
  assert.equal(fs.readFileSync(path.join(root, 'staged.txt'), 'utf8'), 'chunk-one\nchunk-two\n');

  console.log('Unified edit parity tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
