import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RELEASE_GATE_CHECKS = Object.freeze([
  check('capability_policy', 'Capability negotiation and execution-mode policy', 'test/mcp-execution-mode-unit.mjs'),
  check('transport_bounds', 'Transport routing, timeout, output, abort, and cleanup bounds', 'test/mcp-transport-tasks-unit.mjs'),
  check('task_lifecycle', 'Native task lifecycle, persistence, authorization, expiry, and redaction', 'test/native-task-service-unit.mjs'),
  check('task_protocol', 'Native task protocol input, replay, capability, and ownership rules', 'test/native-task-protocol-unit.mjs'),
  check('work_session_isolation', 'Principal-bound repository work-session ownership', 'test/work-session-principal-isolation-unit.mjs'),
  check('strict_protocol', 'Strict MCP 2026 envelope and header validation', 'test/mcp-2026-header-unit.mjs'),
  check('http_matrix', 'HTTP capability matrix and synchronous task-protocol lifecycle', 'test/native-tasks-http.mjs'),
  check('process_lifecycle', 'Persistent-process independence, ownership, restart, and bounded logs', 'test/process-manager-unit.mjs'),
  check('process_cancellation', 'Finite-process cancellation and process-tree cleanup', 'test/process-cancellation-unit.mjs'),
  check('tool_surface', 'Public tool count, probe removal, annotations, and result schemas', 'test/tool-registry-unit.mjs'),
  check('dashboard_contract', 'Capability, task, work-session, process, and terminal dashboard states', 'test/dashboard-runtime-observability-unit.mjs'),
  check('dashboard_rendering', 'Dashboard renderer smoke coverage', 'test/dashboard-ui-smoke.mjs'),
  check('stdio_discovery', 'stdio discovery and public tool surface', 'test/smoke.mjs'),
  check('http_discovery', 'HTTP discovery and native Tasks advertisement', 'test/http-smoke.mjs'),
  check('http_authentication', 'HTTP authentication and stateless ChatGPT initialization', 'test/http-auth-smoke.mjs'),
  check('current_surface_without_tasks', 'Current tool surface remains synchronous without Tasks capability', 'test/chatgpt-local-hard-cutover-smoke.mjs')
]);

const RELEASE_GATE_BLOCKERS = Object.freeze([
  'tasks_returned_without_negotiation',
  'malformed_capability_fallback',
  'chatgpt_initialize_rejected',
  'task_notification_response',
  'missing_server_identity_metadata',
  'public_probe_registered',
  'obsolete_capability_error',
  'unauthorized_task_access',
  'unauthorized_work_session_access',
  'replayed_input_resumed_twice',
  'invalid_terminal_transition',
  'cancellation_without_process_cleanup',
  'unbounded_synchronous_execution',
  'persistent_process_lifecycle_regression'
]);

function check(id, label, file) {
  return Object.freeze({ id, label, file });
}

function runReleaseGate(options = {}) {
  const jsonOnly = options.jsonOnly === true;
  const startedAt = new Date();
  const results = [];

  for (const entry of RELEASE_GATE_CHECKS) {
    const absolute = path.join(root, entry.file);
    const started = Date.now();
    if (!fs.existsSync(absolute)) {
      results.push({ ...entry, status: 'failed', durationMs: 0, exitCode: null, error: 'required_test_missing' });
      if (!jsonOnly) console.error(`FAIL ${entry.id}: required test is missing (${entry.file})`);
      continue;
    }

    const result = spawnSync(process.execPath, [absolute], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024
    });
    const status = result.status === 0 && !result.error ? 'passed' : 'failed';
    const record = {
      ...entry,
      status,
      durationMs: Date.now() - started,
      exitCode: Number.isInteger(result.status) ? result.status : null,
      timedOut: result.error?.code === 'ETIMEDOUT'
    };
    if (status === 'failed') {
      record.error = result.error?.message || 'test_failed';
      record.stdoutTail = tail(result.stdout);
      record.stderrTail = tail(result.stderr);
    }
    results.push(record);
    if (!jsonOnly) {
      const prefix = status === 'passed' ? 'PASS' : 'FAIL';
      console.log(`${prefix} ${entry.id} (${record.durationMs}ms) - ${entry.label}`);
      if (status === 'failed') {
        if (record.stdoutTail) console.error(record.stdoutTail);
        if (record.stderrTail) console.error(record.stderrTail);
      }
    }
  }

  const failed = results.filter(result => result.status !== 'passed');
  const endedAt = new Date();
  const summary = {
    schemaVersion: 1,
    gate: 'native_mcp_tasks_source_release_gate',
    scope: 'source_and_runtime_contracts',
    status: failed.length === 0 ? 'passed' : 'failed',
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    blockerClasses: RELEASE_GATE_BLOCKERS,
    passedCount: results.length - failed.length,
    failedCount: failed.length,
    checks: results
  };
  console.log(JSON.stringify(summary));
  return summary;
}

function tail(value, limit = 4000) {
  const text = String(value || '').trim();
  return text.length <= limit ? text : text.slice(-limit);
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const summary = runReleaseGate({ jsonOnly: process.argv.includes('--json') });
  if (summary.status !== 'passed') process.exitCode = 1;
}

export { RELEASE_GATE_BLOCKERS, RELEASE_GATE_CHECKS, runReleaseGate };
