import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readAudit } from "../src/audit.js";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-audit-task-'));
const auditLogPath = path.join(dir, 'audit.jsonl');
const taskId = 'long-task';
const lines = [];
for (let index = 0; index < 1500; index += 1) {
  lines.push(JSON.stringify({ ts: new Date().toISOString(), taskId, tool: `tool-${index}`, ok: true }));
}
fs.writeFileSync(auditLogPath, `${lines.join('\n')}\n`);
const result = readAudit({ auditLogPath }, { limit: 10000, taskId });
assert.equal(result.entries.length, 1500, 'task-scoped reads must not truncate at 1000 events');
fs.rmSync(dir, { recursive: true, force: true });

console.log('Task-scoped audit history tests passed.');
