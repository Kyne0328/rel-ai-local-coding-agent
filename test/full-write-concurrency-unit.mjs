import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { workspaceWrite } from "../src/localRepoBridge.js";
import { planEdit } from "../src/executionPlanner.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-full-write-concurrency-'));
const workspace = {
  alias: 'repo',
  path: root,
  testCommands: {},
  commands: {},
  context: { snapshotMaxFiles: 100 }
};
const config = {
  stateDir: path.join(root, '.state'),
  patch: { backup: false, requireCleanGit: false, maxUpdateBytes: 2097152 }
};
const target = path.join(root, 'config.txt');
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

try {
  fs.writeFileSync(target, 'version=1\n');
  const originalSha = sha('version=1\n');

  const direct = workspaceWrite(workspace, config, {
    path: 'config.txt',
    content: 'version=2\n',
    expectedSha256: originalSha
  });
  assert.equal(direct.ok, true);
  assert.equal(direct.result.oldSha256, originalSha);
  assert.equal(fs.readFileSync(target, 'utf8'), 'version=2\n');

  assert.throws(
    () => workspaceWrite(workspace, config, {
      path: 'config.txt',
      content: 'version=3\n',
      expectedSha256: originalSha
    }),
    /refused stale expectedSha256/,
    'direct full-file writes must reject a stale hash'
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'version=2\n');

  const currentSha = sha('version=2\n');
  const planned = await planEdit(workspace, config, {
    path: 'config.txt',
    content: 'version=3\n',
    expectedSha256: currentSha
  });
  assert.equal(planned.ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'version=3\n');

  await assert.rejects(
    () => planEdit(workspace, config, {
      path: 'config.txt',
      content: 'version=4\n',
      expectedSha256: currentSha
    }),
    /refused stale expectedSha256/,
    'relai_edit content mode must reject a stale hash'
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'version=3\n');

  const stagedStartSha = sha('version=3\n');
  const start = workspaceWrite(workspace, config, {
    stage: 'start',
    path: 'config.txt',
    content: 'version=',
    expectedSha256: stagedStartSha
  });
  workspaceWrite(workspace, config, { stage: 'append', writeId: start.writeId, content: '4\n' });
  fs.writeFileSync(target, 'user-change=true\n');
  assert.throws(
    () => workspaceWrite(workspace, config, { stage: 'commit', writeId: start.writeId }),
    /refused stale expectedSha256/,
    'staged writes must preserve the hash captured at start and reject a changed target at commit'
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'user-change=true\n');

  console.log('Full-file write concurrency protection passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
