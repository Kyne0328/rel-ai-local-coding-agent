import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

import { appendOperation, readRecentOperations, summarizeOperations } from '../src/journal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-journal-'));
const config = { stateDir: path.join(tmp, 'state') };
const workspace = { alias: 'app', path: path.join(tmp, 'repo') };
fs.mkdirSync(workspace.path, { recursive: true });

try {
  const journal = summarizeOperations(config, workspace, 1).path;
  fs.mkdirSync(path.dirname(journal), { recursive: true });

  const old = [
    { id: 'old-1', type: 'old-1' },
    { id: 'old-2', type: 'old-2' }
  ].map(item => `${JSON.stringify(item)}\n`).join('');
  fs.writeFileSync(`${journal}.1`, old, 'utf8');
  fs.writeFileSync(journal, `${JSON.stringify({ id: 'new-1', type: 'new-1' })}\n`, 'utf8');
  assert.deepEqual(
    readRecentOperations(config, workspace, 3).map(item => item.id),
    ['old-1', 'old-2', 'new-1'],
    'recent reads should span the one retained rotation without reading older history'
  );

  fs.rmSync(`${journal}.1`, { force: true });
  fs.writeFileSync(journal, Buffer.alloc(8 * 1024 * 1024, 0x20));
  appendOperation(config, workspace, { type: 'after-rotation', ok: true });
  assert.equal(fs.existsSync(`${journal}.1`), true, 'oversized journal rotates before the next append');
  const recent = readRecentOperations(config, workspace, 1);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].type, 'after-rotation');
  assert.ok(fs.statSync(journal).size < 1024 * 1024, 'active journal stays bounded after rotation');

  console.log('Operation journal bounded tail/rotation tests passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
