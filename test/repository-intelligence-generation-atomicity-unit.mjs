import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { currentGeneration, openIndexDatabase, repositoryIndexPath } from '../src/repository/intelligence/database.js';
import { executeRepositoryIndexJob } from '../src/repository/intelligence/indexBuild.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-repository-generation-atomicity-'));
const workspaceRoot = path.join(root, 'workspace');
const stateDir = path.join(root, 'state');
fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });

const fileCount = 120;
for (let index = 0; index < fileCount; index += 1) {
  fs.writeFileSync(path.join(workspaceRoot, 'src', `module-${index}.js`), sourceFor(index, 1));
}

const workspace = { alias: 'generation-atomicity', path: workspaceRoot, context: {} };
const config = { stateDir };
const databaseFile = repositoryIndexPath(config, workspace);

try {
  const initial = await repositoryIntelligence.ensure(workspace, config, { force: true, watch: false, maxFiles: fileCount });
  const baselineGeneration = initial.generation;
  const baselineHash = readHash(databaseFile, 'src/module-0.js');
  assert.equal(baselineHash, hash(sourceFor(0, 1)));

  await repositoryIntelligence.shutdown();
  for (let index = 0; index < fileCount; index += 1) {
    fs.writeFileSync(path.join(workspaceRoot, 'src', `module-${index}.js`), sourceFor(index, 2));
  }

  let abortChecks = 0;
  const signal = {
    reason: new Error('interrupt after the first write batch'),
    get aborted() {
      abortChecks += 1;
      return abortChecks >= 105;
    }
  };

  await assert.rejects(
    executeRepositoryIndexJob({
      kind: 'refresh',
      workspace,
      databaseFile,
      maxFiles: fileCount,
      paths: null,
      zoektSettings: {}
    }, signal),
    error => error?.code === 'INDEX_ABORTED' && error?.name === 'AbortError'
  );

  const db = openIndexDatabase(databaseFile, { readonly: true });
  try {
    assert.equal(Number(currentGeneration(db)?.id || 0), baselineGeneration,
      'an interrupted refresh must keep the last fully committed generation current');
    assert.equal(String(db.prepare('SELECT content_hash FROM files WHERE path=?').get('src/module-0.js')?.content_hash || ''), baselineHash,
      'an interrupted refresh must not leak a committed first batch into the previous generation');
    assert.equal(Number(db.prepare("SELECT count(*) AS count FROM generations WHERE status='failed'").get()?.count || 0), 1,
      'an interrupted build should remain diagnosable without publishing its partial facts');
    assert.equal(Number(db.prepare("SELECT count(*) AS count FROM generations WHERE status='building'").get()?.count || 0), 0,
      'an interrupted build must not leave a generation permanently marked as building');
  } finally {
    db.close();
  }
} finally {
  await repositoryIntelligence.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
}

function sourceFor(index, revision) {
  return `export function symbol${index}() { return ${index + revision}; }\n`;
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readHash(databaseFile, relativePath) {
  const db = openIndexDatabase(databaseFile, { readonly: true });
  try {
    return String(db.prepare('SELECT content_hash FROM files WHERE path=?').get(relativePath)?.content_hash || '');
  } finally {
    db.close();
  }
}

console.log('Repository Intelligence generation atomicity test passed.');
