import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDesktopLocalDataManager } from '../electron/desktop-local-data.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-local-data-'));
const stateDir = path.join(root, 'state');
const logPath = path.join(root, 'service.log');
const auditPath = path.join(stateDir, 'audit.jsonl');
let activeTaskCount = 0;
let openedPath = '';

function write(relative, bytes) {
  const target = path.join(stateDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'x'.repeat(bytes));
}

try {
  write('sessions/task.json', 11);
  write('audit.jsonl', 13);
  write('audit.jsonl.1', 17);
  write('output-spills/task/output.log', 19);
  write('repository-intelligence/repo/graph.db', 23);
  fs.writeFileSync(logPath, 'x'.repeat(29));

  const manager = createDesktopLocalDataManager({
    getConfig: () => ({ stateDir, auditLogPath: auditPath }),
    getServiceLogPath: () => logPath,
    getTaskActivity: () => ({ activeTaskCount }),
    openPath: async target => { openedPath = target; return ''; }
  });

  const usage = await manager.getUsage();
  assert.equal(usage.ok, true);
  assert.equal(usage.categories.history.bytes, 41);
  assert.equal(usage.categories.logs.bytes, 29);
  assert.equal(usage.categories.temporary.bytes, 19);
  assert.equal(usage.categories.indexes.bytes, 23);
  assert.equal(usage.totalBytes, 112);

  activeTaskCount = 1;
  const blocked = await manager.clearTemporary();
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /task is still active/i);
  assert.equal(fs.existsSync(path.join(stateDir, 'output-spills')), true);

  activeTaskCount = 0;
  const cleared = await manager.clearTemporary();
  assert.equal(cleared.ok, true);
  assert.equal(cleared.categories.temporary.bytes, 0);
  assert.equal(fs.existsSync(path.join(stateDir, 'output-spills')), false);

  assert.equal((await manager.openDataFolder()).ok, true);
  assert.equal(openedPath, path.resolve(stateDir));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Desktop local data controls unit tests passed.');
