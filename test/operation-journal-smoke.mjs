import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeTextFileSafe } from '../src/safety.js';
import { appendOperation, summarizeOperations } from '../src/journal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-journal-'));
const workspaceRoot = path.join(tmp, 'repo');
const stateDir = path.join(tmp, 'state');
fs.mkdirSync(workspaceRoot, { recursive: true });

try {
  const first = writeTextFileSafe(workspaceRoot, 'a.txt', 'one\n');
  if (!first.verified) throw new Error('first write was not verified');
  if (first.sha256 !== first.expectedSha256) throw new Error('first write hash mismatch');

  const second = writeTextFileSafe(workspaceRoot, 'a.txt', 'two\n', { expectedSha256: first.sha256 });
  if (!second.verified) throw new Error('second write was not verified');
  if (fs.readFileSync(path.join(workspaceRoot, 'a.txt'), 'utf8') !== 'two\n') {
    throw new Error('fresh reread did not see written content');
  }

  let mismatch = false;
  try {
    writeTextFileSafe(workspaceRoot, 'a.txt', 'three\n', { expectedSha256: first.sha256 });
  } catch (_error) {
    mismatch = true;
  }
  if (!mismatch) throw new Error('expectedSha256 mismatch should fail');

  const config = { stateDir };
  const workspace = { alias: 'repo', path: workspaceRoot };
  const op = appendOperation(config, workspace, {
    type: 'write',
    ok: true,
    paths: ['a.txt'],
    validation: { freshRead: true }
  });
  const summary = summarizeOperations(config, workspace, 5);
  if (!summary.recent.some((item) => item.id === op.id && item.paths.includes('a.txt'))) {
    throw new Error('journal summary missing operation');
  }

  console.log('Operation journal smoke test passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
