import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RELEASE_GATE_BLOCKERS,
  RELEASE_GATE_CHECKS
} from '../scripts/native-tasks-release-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ids = RELEASE_GATE_CHECKS.map(check => check.id);
assert.equal(new Set(ids).size, ids.length, 'release-gate check identifiers must be unique');
for (const check of RELEASE_GATE_CHECKS) {
  assert.match(check.id, /^[a-z0-9_]+$/, 'release-gate identifiers must remain machine-readable');
  assert.ok(String(check.label || '').trim(), `${check.id} must explain what it validates`);
}
const gateLabels = RELEASE_GATE_CHECKS.map(check => check.label).join('\n');
for (const category of [/capability/i, /transport/i, /task lifecycle/i, /ownership/i, /process.*cancellation/i, /public tool/i, /dashboard/i, /stdio/i, /HTTP/i]) {
  assert.match(gateLabels, category, `release gate must retain ${category} coverage`);
}
for (const check of RELEASE_GATE_CHECKS) {
  assert.ok(fs.existsSync(path.join(root, check.file)), `release-gate test is missing: ${check.file}`);
}
assert.equal(new Set(RELEASE_GATE_BLOCKERS).size, RELEASE_GATE_BLOCKERS.length, 'release blocker classes must be unique');
for (const blocker of RELEASE_GATE_BLOCKERS) assert.match(blocker, /^[a-z0-9_]+$/, 'release blocker classes must remain machine-readable');
const blockerText = RELEASE_GATE_BLOCKERS.join('\n');
for (const category of [/unauthorized_task_access/, /unauthorized_work_session_access/, /cancellation_without_process_cleanup/, /unbounded_synchronous_execution/, /persistent_process_lifecycle_regression/]) {
  assert.match(blockerText, category, `release blockers must retain ${category} protection`);
}

assert.equal(fs.existsSync(path.join(root, 'src', 'nativeTasksProbe.js')), false, 'obsolete native Tasks probe implementation must remain deleted');

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.match(String(packageJson.scripts['test:native-tasks-release-gate'] || ''), /scripts\/native-tasks-release-gate\.mjs/, 'the named release gate must still invoke the native Tasks gate');

const stdioSmoke = fs.readFileSync(path.join(root, 'test', 'smoke.mjs'), 'utf8');
assert.match(stdioSmoke, /capabilities\?\.extensions\?\.\['io\.modelcontextprotocol\/tasks'\]/);
assert.match(stdioSmoke, /stdio must advertise native Tasks support/);
assert.doesNotMatch(stdioSmoke, /stdio must not advertise native Tasks/);

const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
assert.match(workflow, /npm run test:native-tasks-release-gate/,
  'release automation must execute the native Tasks safety gate regardless of the human-readable step label');

const docs = fs.readFileSync(path.join(root, 'docs', 'NATIVE_TASKS_RELEASE_GATE.md'), 'utf8');
assert.match(docs, /HTTP or stdio \| Advertised \| Long, multi-step, or indeterminate \| Native MCP task/);
assert.match(docs, /HTTP or stdio \| Not advertised \| Within synchronous limits \| Bounded synchronous result/);
assert.match(docs, /HTTP also accepts ChatGPT's SDK-supported stateless `2025-11-25` initialize flow/i);
assert.match(docs, /no response is emitted for JSON-RPC notifications/i);
assert.match(docs, /server identity metadata/i);
assert.match(docs, /connection-scoped local principal/i);

console.log('Native Tasks release-gate manifest, workflow wiring, capability matrix, and documentation contracts passed.');
