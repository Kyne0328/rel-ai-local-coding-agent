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
for (const required of [
  'capability_policy',
  'transport_bounds',
  'task_lifecycle',
  'task_protocol',
  'work_session_isolation',
  'strict_protocol',
  'http_matrix',
  'http_parity',
  'stdio_matrix',
  'process_lifecycle',
  'process_cancellation',
  'tool_surface',
  'dashboard_contract',
  'modern_no_tasks_fallback'
]) assert.ok(ids.includes(required), `release gate must include ${required}`);
for (const check of RELEASE_GATE_CHECKS) {
  assert.ok(fs.existsSync(path.join(root, check.file)), `release-gate test is missing: ${check.file}`);
}
for (const blocker of [
  'tasks_returned_without_negotiation',
  'malformed_capability_fallback',
  'chatgpt_initialize_rejected',
  'task_notification_response',
  'missing_server_identity_metadata',
  'http_stdio_divergence',
  'public_probe_registered',
  'unauthorized_task_access',
  'unauthorized_work_session_access',
  'replayed_input_resumed_twice',
  'invalid_terminal_transition',
  'cancellation_without_process_cleanup',
  'unbounded_synchronous_execution',
  'persistent_process_lifecycle_regression'
]) assert.ok(RELEASE_GATE_BLOCKERS.includes(blocker), `release blocker is missing: ${blocker}`);

assert.equal(fs.existsSync(path.join(root, 'src', 'nativeTasksProbe.js')), false, 'obsolete native Tasks probe implementation must remain deleted');

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(packageJson.scripts['test:native-tasks-release-gate'], 'node scripts/native-tasks-release-gate.mjs');

const stdioSmoke = fs.readFileSync(path.join(root, 'test', 'smoke.mjs'), 'utf8');
assert.match(stdioSmoke, /capabilities\?\.extensions\?\.\['io\.modelcontextprotocol\/tasks'\]/);
assert.match(stdioSmoke, /stdio must advertise native Tasks support/);
assert.doesNotMatch(stdioSmoke, /stdio must not advertise native Tasks/);

const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
assert.match(workflow, /Run native Tasks release gate/);
assert.match(workflow, /npm run test:native-tasks-release-gate/);

const docs = fs.readFileSync(path.join(root, 'docs', 'NATIVE_TASKS_RELEASE_GATE.md'), 'utf8');
assert.match(docs, /HTTP or stdio \| Advertised \| Long, multi-step, or indeterminate \| Native MCP task/);
assert.match(docs, /HTTP or stdio \| Not advertised \| Within synchronous limits \| Bounded synchronous result/);
assert.match(docs, /HTTP also accepts ChatGPT's SDK-supported stateless `2025-11-25` initialize flow/i);
assert.match(docs, /no response is emitted for JSON-RPC notifications/i);
assert.match(docs, /server identity metadata/i);
assert.match(docs, /connection-scoped local principal/i);

console.log('Native Tasks release-gate manifest, workflow wiring, capability matrix, and documentation contracts passed.');
