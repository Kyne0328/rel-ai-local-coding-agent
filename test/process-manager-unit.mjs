import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  listManagedProcesses,
  readManagedProcess,
  startManagedProcess,
  stopAllManagedProcesses,
  stopManagedProcess,
  writeManagedProcess
} from '../src/processManager.js';

const processSource = fs.readFileSync(new URL('../src/process.js', import.meta.url), 'utf8');
assert.doesNotMatch(processSource, /spawnSync|PowerShell/, 'managed process liveness and termination must not block the MCP event loop');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-process-manager-'));
const stateDir = path.join(root, 'state');
const workspaceRoot = path.join(root, 'workspace');
const config = { stateDir };
const workspace = { alias: 'app', path: workspaceRoot };
const otherWorkspace = { alias: 'other', path: path.join(root, 'other-workspace') };
const principalA = { clientId: 'client-a', authMode: 'oauth' };
const principalB = { clientId: 'client-b', authMode: 'oauth' };
const ownerStart = { taskId: 'work-session-a', principal: principalA, workspace: 'app' };
const ownerLater = { taskId: 'work-session-a', principal: principalA, workspace: 'app' };
const otherSession = { taskId: 'work-session-b', principal: principalA, workspace: 'app' };
const otherPrincipal = { taskId: 'work-session-c', principal: principalB, workspace: 'app' };
const otherWorkspaceContext = { taskId: 'work-session-d', principal: principalA, workspace: 'other' };
const createdProcessIds = [];
let externalChild = null;

fs.mkdirSync(workspaceRoot, { recursive: true });
fs.mkdirSync(otherWorkspace.path, { recursive: true });
const persistentScript = path.join(workspaceRoot, 'persistent-child.cjs');
const exitScript = path.join(workspaceRoot, 'exit-child.cjs');
fs.writeFileSync(persistentScript, `
process.stdout.write(Buffer.from([0xff, 0xfe, 0xfd]));
process.stdout.write('READY\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', value => {
  if (value.startsWith('NOISE:')) {
    const count = Number(value.slice(6)) || 0;
    process.stdout.write('x'.repeat(count) + '\\n');
    return;
  }
  process.stdout.write('ECHO:' + value);
});
setInterval(() => {}, 1000);
`);
fs.writeFileSync(exitScript, `process.stderr.write('startup failed\\n'); process.exit(7);\n`);

try {
  const initialInput = 'initial `$value "quoted"\n';
  const started = await startManagedProcess(workspace, config, {
    executable: process.execPath,
    argv: [persistentScript],
    input: initialInput,
    startupWaitMs: 100,
    maxLogBytes: 65536,
    label: 'persistent-managed-test',
    kind: 'service',
    purpose: 'Exercise persistent process lifecycle behavior.'
  }, ownerStart);
  createdProcessIds.push(started.processId);

  assert.match(started.processId, /^proc_[A-Za-z0-9_-]{20,160}$/);
  assert.equal(started.workspaceId, 'app');
  assert.equal(started.lifecycle, 'persistent');
  assert.equal(started.kind, 'service');
  assert.match(started.purpose, /persistent process lifecycle/);
  assert.match(started.metadataRevision, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(started.originatingTaskId, null);
  assert.equal(started.workSessionId, ownerStart.taskId);
  assert.equal(started.readiness.verified, true);
  assert.equal(started.status, 'running');

  const first = await waitForProcess(started.processId, ownerStart, snapshot =>
    snapshot.stdout.text.includes('READY') && snapshot.stdout.text.includes(`ECHO:${initialInput}`)
  );
  assert.match(first.stdout.text, /READY/);
  assert.ok(first.stdout.text.includes(`ECHO:${initialInput}`), 'direct process input must preserve backticks, dollar signs, quotes, and newlines');
  const deltaOnly = readManagedProcess(config, {
    processId: started.processId,
    stdoutOffset: first.stdout.nextOffset,
    stderrOffset: first.stderr.nextOffset,
    metadataRevision: first.metadataRevision
  }, ownerLater);
  assert.equal(deltaOnly.label, undefined);
  assert.equal(deltaOnly.metadataRevision, first.metadataRevision);
  assert.equal(first.stdout.invalidUtf8, true);
  assert.ok(first.stdout.base64.length > 0);

  await sleep(100);
  const afterStartupCall = readManagedProcess(config, {
    processId: started.processId,
    stdoutOffset: first.stdout.nextOffset,
    stderrOffset: 0
  }, ownerLater);
  assert.equal(afterStartupCall.status, 'running');

  assert.throws(
    () => readManagedProcess(config, { processId: started.processId }, otherPrincipal),
    error => error?.code === 'PROCESS_ACCESS_DENIED',
    'distinct object principals must not collapse to one process identity'
  );
  assert.throws(
    () => readManagedProcess(config, { processId: started.processId }, otherWorkspaceContext),
    error => error?.code === 'PROCESS_WORKSPACE_MISMATCH'
  );
  assert.throws(
    () => readManagedProcess(config, { processId: started.processId }, otherSession),
    error => error?.code === 'PROCESS_SESSION_MISMATCH',
    'another logical task from the same principal must not read this process'
  );
  assert.throws(
    () => writeManagedProcess(config, { processId: started.processId, input: 'cross-task\n' }, otherSession),
    error => error?.code === 'PROCESS_SESSION_MISMATCH',
    'another logical task from the same principal must not write to this process'
  );
  await assert.rejects(
    () => stopManagedProcess(config, { processId: started.processId, graceMs: 0 }, otherSession),
    error => error?.code === 'PROCESS_SESSION_MISMATCH',
    'another logical task from the same principal must not stop this process'
  );

  const written = writeManagedProcess(config, {
    processId: started.processId,
    input: 'hello\n'
  }, ownerLater);
  assert.equal(written.acceptedBytes, 6);
  const echoed = await waitForProcess(started.processId, ownerLater, snapshot => snapshot.stdout.text.includes('ECHO:hello'), {
    stdoutOffset: first.stdout.nextOffset
  });
  assert.match(echoed.stdout.text, /ECHO:hello/);

  writeManagedProcess(config, {
    processId: started.processId,
    input: 'NOISE:120000\n'
  }, ownerLater);
  const noisy = await waitForProcess(started.processId, ownerLater, snapshot => snapshot.stdoutBytes >= 120000);
  assert.ok(noisy.stdoutRetainedFromOffset > 0);
  assert.equal(noisy.stdout.truncatedBefore, true);
  assert.equal(noisy.stdout.offset, noisy.stdout.retainedFromOffset);
  assert.ok(noisy.stdout.totalBytes >= 120000);
  assert.ok(fs.statSync(path.join(stateDir, 'processes', started.processId, 'stdout.log')).size <= 65536);

  const cursor = noisy.stdout.totalBytes;
  writeManagedProcess(config, {
    processId: started.processId,
    input: 'after-noise\n'
  }, ownerLater);
  const incremental = await waitForProcess(started.processId, ownerLater, snapshot => snapshot.stdout.text.includes('ECHO:after-noise'), {
    stdoutOffset: cursor
  });
  assert.equal(incremental.stdout.requestedOffset, cursor);
  assert.match(incremental.stdout.text, /ECHO:after-noise/);

  const listedByOwner = listManagedProcesses(config, { workspace: 'app' }, ownerLater);
  assert.ok(listedByOwner.processes.some(item => item.processId === started.processId));
  const hiddenFromOtherSession = listManagedProcesses(config, { workspace: 'app' }, otherSession);
  assert.equal(hiddenFromOtherSession.processes.some(item => item.processId === started.processId), false);
  const hiddenFromOtherPrincipal = listManagedProcesses(config, { workspace: 'app' }, otherPrincipal);
  assert.equal(hiddenFromOtherPrincipal.processes.some(item => item.processId === started.processId), false);
  assert.throws(
    () => listManagedProcesses(config, { workspace: 'other' }, ownerLater),
    error => error?.code === 'PROCESS_WORKSPACE_MISMATCH'
  );

  const stopped = await stopManagedProcess(config, {
    processId: started.processId,
    graceMs: 500
  }, ownerLater);
  assert.equal(stopped.status, 'stopped');
  assert.ok(stopped.endedAt);
  assert.equal(stopped.duplicate, false);
  const duplicateStop = await stopManagedProcess(config, {
    processId: started.processId,
    graceMs: 0
  }, ownerLater);
  assert.equal(duplicateStop.status, stopped.status);
  assert.equal(duplicateStop.endedAt, stopped.endedAt);
  assert.equal(duplicateStop.duplicate, true);
  const activeAfterStop = listManagedProcesses(config, { workspace: 'app' }, ownerLater);
  assert.equal(activeAfterStop.processes.some(item => item.processId === started.processId), false);
  const historyAfterStop = listManagedProcesses(config, { workspace: 'app', includeTerminal: true }, ownerLater);
  assert.equal(historyAfterStop.processes.some(item => item.processId === started.processId), true);

  const cancellationController = new AbortController();
  const cancelledStart = startManagedProcess(workspace, config, {
    executable: process.execPath,
    argv: [persistentScript],
    startupWaitMs: 3000,
    label: 'cancel-during-startup',
    kind: 'service',
    purpose: 'Exercise startup cancellation.'
  }, {
    taskId: 'work-session-cancel',
    principal: 'client-a',
    workspace: 'app',
    signal: cancellationController.signal
  });
  setTimeout(() => cancellationController.abort(), 100);
  await assert.rejects(
    cancelledStart,
    error => error?.code === 'TASK_CANCELLED' && error.cancelled === true
  );
  const afterStartupCancellation = listManagedProcesses(config, { workspace: 'app' }, ownerLater);
  assert.equal(afterStartupCancellation.processes.some(item => item.label === 'cancel-during-startup'
    && ['starting', 'running', 'stopping'].includes(item.status)), false);

  await assert.rejects(
    startManagedProcess(workspace, config, {
      executable: process.execPath,
      argv: [exitScript],
      startupWaitMs: 500,
      label: 'startup-failure',
      kind: 'service',
      purpose: 'Exercise startup failure cleanup.'
    }, ownerLater),
    /exited during startup|Could not start managed process/i
  );
  const afterStartupFailure = listManagedProcesses(config, { workspace: 'app' }, ownerLater);
  assert.equal(afterStartupFailure.processes.some(item => item.label === 'startup-failure'
    && ['starting', 'running', 'stopping'].includes(item.status)), false);

  externalChild = spawn(process.execPath, [persistentScript], {
    cwd: workspaceRoot,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore']
  });
  await once(externalChild, 'spawn');
  const staleProcessId = `proc_${'r'.repeat(24)}`;
  const staleDirectory = path.join(stateDir, 'processes', staleProcessId);
  fs.mkdirSync(staleDirectory, { recursive: true });
  fs.writeFileSync(path.join(staleDirectory, 'stdout.log'), 'historical output\n');
  fs.writeFileSync(path.join(staleDirectory, 'stderr.log'), '');
  fs.writeFileSync(path.join(staleDirectory, 'metadata.json'), JSON.stringify({
    schemaVersion: 2,
    runtimeId: 'previous-runtime',
    processId: staleProcessId,
    workspaceId: 'app',
    workspacePath: workspaceRoot,
    lifecycle: 'persistent',
    commandSummary: 'stale child',
    label: 'stale-restart-record',
    cwd: '.',
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: '',
    exitCode: null,
    signal: '',
    pid: externalChild.pid,
    stdoutBytes: 18,
    stderrBytes: 0,
    stdoutStartOffset: 0,
    stderrStartOffset: 0,
    environmentKeys: [],
    maxLogBytes: 65536
  }, null, 2));

  assert.throws(
    () => readManagedProcess(config, { processId: staleProcessId }, {
      connector: true,
      principal: 'client-a',
      workspace: 'app'
    }),
    error => error?.code === 'PROCESS_ACCESS_DENIED'
  );
  const restored = readManagedProcess(config, { processId: staleProcessId });
  assert.equal(restored.status, 'orphaned');
  assert.match(restored.error, /survived a Rel\.AI restart/i);
  const restoredStop = await stopManagedProcess(config, { processId: staleProcessId, graceMs: 250 });
  assert.equal(restoredStop.status, 'stopped');
  assert.equal(restoredStop.duplicate, false);
  assert.equal(await waitForChildExit(externalChild, 3000), true);
  externalChild = null;

  console.log('Managed process identity, ownership, persistence, bounded output, restart, cancellation, and idempotent stop tests passed.');
} finally {
  await stopAllManagedProcesses(config).catch(() => {});
  if (externalChild) {
    try { externalChild.kill('SIGKILL'); } catch {}
    await waitForChildExit(externalChild, 3000).catch(() => false);
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

async function waitForProcess(processId, context, predicate, options = {}, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let snapshot = null;
  while (Date.now() < deadline) {
    snapshot = readManagedProcess(config, {
      processId,
      stdoutOffset: options.stdoutOffset || 0,
      stderrOffset: options.stderrOffset || 0,
      maxBytes: options.maxBytes || 65536
    }, context);
    if (predicate(snapshot)) return snapshot;
    await sleep(25);
  }
  assert.fail(`Timed out waiting for managed process ${processId}: ${JSON.stringify(snapshot)}`);
}

async function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode) return true;
  return Promise.race([
    once(child, 'close').then(() => true),
    sleep(timeoutMs).then(() => child.exitCode !== null || Boolean(child.signalCode))
  ]);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
