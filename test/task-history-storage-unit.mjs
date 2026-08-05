import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { listSessions, readSession, resetTaskHistoryCaches, writeSession } from "../src/taskHistoryStorage.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-history-storage-'));
const id = 'shared-task';
const file = path.join(directory, `${crypto.createHash('sha256').update(id).digest('hex')}.json`);

try {
  writeSession(directory, { id, workspace: 'repo', summary: 'before' });
  assert.equal(listSessions(directory, 10)[0]?.summary, 'before');

  // Simulate another Rel.AI process replacing the same session file with a same-size
  // payload. A filename-only metadata cache used to keep returning "before" forever.
  fs.writeFileSync(file, JSON.stringify({ id, workspace: 'repo', summary: 'after!' }));
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(file, future, future);

  assert.equal(listSessions(directory, 10)[0]?.summary, 'after!');
  assert.equal(readSession(directory, id)?.summary, 'after!');

  const completedId = 'completed-task';
  writeSession(directory, {
    id: completedId,
    status: 'completed',
    progress: { mode: 'indeterminate', label: 'Waiting for the next task step' }
  });
  const completed = readSession(directory, completedId);
  assert.equal(completed?.progress?.mode, 'complete');
  assert.equal(completed?.progress?.percentage, 100);

  console.log('Task-history listings refresh externally rewritten files and normalize terminal progress.');
} finally {
  resetTaskHistoryCaches();
  fs.rmSync(directory, { recursive: true, force: true });
}
