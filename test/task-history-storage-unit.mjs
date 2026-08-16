import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { listSessions, readSession, resetTaskHistoryCaches, writeSession } from "../src/taskHistoryStorage.js";
import { watchPathFor } from '../src/watchPath.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-history-storage-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const id = 'shared-task';
const file = path.join(directory, `${crypto.createHash('sha256').update(id).digest('hex')}.json`);

try {
  assert.equal(watchPathFor(directory, 'linux'), directory, 'non-Windows watch paths must remain unchanged');
  assert.equal(watchPathFor(directory, 'win32'), fs.realpathSync.native(directory),
    'Windows watch paths must use native long-path resolution before reaching libuv');

  writeSession(directory, { id, workspace: 'repo', summary: 'before' });
  assert.equal(listSessions(directory, 10)[0]?.summary, 'before');

  // Simulate another Rel.AI process replacing the same session file with a same-size
  // payload. A filename-only metadata cache used to keep returning "before" forever.
  fs.writeFileSync(file, JSON.stringify({ version: 3, id, taskId: id, sessionId: id, workspace: 'repo', summary: 'after!' }));
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(file, future, future);

  let refreshed = listSessions(directory, 10)[0]?.summary;
  for (let attempt = 0; refreshed !== 'after!' && attempt < 20; attempt += 1) {
    await delay(10);
    refreshed = listSessions(directory, 10)[0]?.summary;
  }
  assert.equal(refreshed, 'after!', 'directory watcher invalidation must surface external session rewrites promptly');
  assert.equal(readSession(directory, id)?.summary, 'after!');

  const completedId = 'completed-task';
  writeSession(directory, {
    id: completedId,
    status: 'completed',
    summary: 'Completed work.',
    progress: { mode: 'indeterminate', label: 'Waiting for the next task step' }
  });
  const completed = readSession(directory, completedId);
  assert.equal(completed?.progress?.mode, 'complete');
  assert.equal(completed?.progress?.percentage, 100);
  assert.equal(completed?.resultSummary, 'Completed work.');

  console.log('Task-history listings refresh externally rewritten files and normalize completed task state.');
} finally {
  resetTaskHistoryCaches();
  fs.rmSync(directory, { recursive: true, force: true });
}