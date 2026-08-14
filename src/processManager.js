import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { combineAbortSignals } from './abortSignals.js';
import { readJsonFile, writeJsonAtomic, writeJsonAtomicAsync } from './durableState.js';
import { normalizeExecutionInvocation, resolveCommandCwd, normalizeCommandEnv, redactCommandForAudit } from './bridge/exec.js';
import { isProcessTreeAlive, terminateProcessTree } from './process.js';
import { makeProcessEnvironment } from './processEnvironment.js';
import { getStateDir } from './statePaths.js';
import { readTaskHistorySession } from './taskHistoryStore.js';
import { runSpan, addSpanEvent, traceContextEnvironment } from './telemetry.js';
import { getCurrentTaskAbortSignal, taskError } from './toolActivity.js';

const PROCESS_SCHEMA_VERSION = 2;
const RUNTIME_ID = crypto.randomUUID();
const RECENT_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_LOG_BYTES = 16 * 1024 * 1024;
const DEFAULT_STARTUP_WAIT_MS = 750;
const DEFAULT_STOP_GRACE_MS = 3000;
const DEFAULT_FORCE_WAIT_MS = 2000;
const METADATA_FLUSH_DELAY_MS = 50;
const METADATA_RESCAN_INTERVAL_MS = 30_000;
const METADATA_PRUNE_INTERVAL_MS = 60_000;
const LOG_FLUSH_DELAY_MS = 10;
const LOG_FLUSH_MAX_BYTES = 64 * 1024;
const ACTIVE_STATUSES = new Set(['starting', 'running', 'stopping']);
const TERMINAL_STATUSES = new Set(['exited', 'failed', 'stopped']);
const processes = new Map();
const metadataScanAt = new Map();
const metadataPruneAt = new Map();
const metadataWriteQueues = new Map();

function processRoot(config) {
  return path.join(getStateDir(config), 'processes');
}

function processDirectory(config, processId) {
  return path.join(processRoot(config), validateProcessId(processId));
}

function validateProcessId(processId) {
  const value = String(processId || '').trim();
  if (!/^proc_[A-Za-z0-9_-]{20,160}$/.test(value)) throw new Error('Invalid processId.');
  return value;
}

async function startManagedProcess(workspace, config, args = {}, context = {}) {
  const invocation = normalizeExecutionInvocation(args, 'relai_process start');
  const kind = String(args.kind || '').trim().toLowerCase();
  if (!['service', 'watcher', 'interactive'].includes(kind)) {
    throw new Error('relai_process_start requires kind: service, watcher, or interactive. Use relai_exec or relai_validate with action "checks" for one-shot commands.');
  }
  const purpose = String(args.purpose || '').trim();
  if (!purpose) throw new Error('relai_process_start requires a persistent-process purpose.');
  if (purpose.length > 300) throw new Error('relai_process_start purpose must be 300 characters or fewer.');
  const cwd = resolveCommandCwd(workspace, args.cwd);
  const env = normalizeCommandEnv(args.env);
  const workSessionId = String(context.taskId || args.work_id || '').trim();
  const principalKey = principalKeyForContext(context);
  const environmentKeys = Object.keys(env).sort();
  const reuseFingerprint = managedProcessReuseFingerprint({
    workspaceId: workspace.alias,
    workSessionId,
    principalKey,
    executionMode: invocation.command ? 'shell' : 'direct',
    command: invocation.displayCommand,
    input: invocation.input || '',
    cwd: cwd.relativePath,
    kind,
    purpose,
    environmentKeys
  });
  hydrateProcessMetadata(config);
  const reusable = args.reuseExisting === false ? null : findReusableManagedProcess(reuseFingerprint);
  if (reusable) {
    return {
      ...processSnapshot(reusable, { includeTail: true, tailBytes: 8192 }),
      reused: true,
      readiness: {
        verified: reusable.status === 'running',
        observedAt: new Date().toISOString(),
        waitedMs: 0,
        status: reusable.status,
        stdoutBytes: reusable.stdoutBytes,
        stderrBytes: reusable.stderrBytes
      }
    };
  }
  const processId = `proc_${crypto.randomBytes(24).toString('base64url')}`;
  const directory = processDirectory(config, processId);
  const stdoutPath = path.join(directory, 'stdout.log');
  const stderrPath = path.join(directory, 'stderr.log');
  const record = {
    schemaVersion: PROCESS_SCHEMA_VERSION,
    runtimeId: RUNTIME_ID,
    processId,
    workspaceId: workspace.alias,
    workspacePath: workspace.path,
    workSessionId,
    principalKey,
    reuseFingerprint,
    lifecycle: 'persistent',
    kind,
    purpose,
    command: invocation.displayCommand,
    commandSummary: redactCommandForAudit(invocation.displayCommand),
    label: String(args.label || '').trim().slice(0, 120) || redactCommandForAudit(invocation.displayCommand),
    cwd: cwd.relativePath,
    status: 'starting',
    startedAt: new Date().toISOString(),
    endedAt: '',
    exitCode: null,
    signal: '',
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutStartOffset: 0,
    stderrStartOffset: 0,
    stdoutPath,
    stderrPath,
    environmentKeys,
    child: null,
    maxLogBytes: clampNumber(args.maxLogBytes, 65536, 256 * 1024 * 1024, DEFAULT_MAX_LOG_BYTES),
    persistTimer: null,
    logBuffers: { stdout: [], stderr: [] },
    logBufferBytes: { stdout: 0, stderr: 0 },
    logFlushTimers: { stdout: null, stderr: null },
    logWritePromises: { stdout: Promise.resolve(), stderr: Promise.resolve() },
    persistenceFailureHandled: false,
    discarded: false
  };

  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(stdoutPath, '', { mode: 0o600 });
    fs.writeFileSync(stderrPath, '', { mode: 0o600 });
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw new Error(`Could not initialize managed process storage: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }

  return runSpan(config, 'relai.process.start', {
    'relai.process.id': processId,
    'relai.workspace': workspace.alias,
    'relai.process.command': record.commandSummary,
    'relai.task.id': workSessionId
  }, async () => {
    const childEnvironment = makeProcessEnvironment(env, { allow: config.processEnvironment?.allow });
    Object.assign(childEnvironment, traceContextEnvironment());
    let child;
    try {
      child = spawn(invocation.processExecutable, invocation.processArgv, {
        cwd: cwd.absolutePath,
        env: childEnvironment,
        detached: process.platform !== 'win32',
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      throw error;
    }

    record.child = child;
    record.pid = child.pid || null;
    processes.set(processId, record);
    const startupSignal = combineAbortSignals(
      context.signal,
      getCurrentTaskAbortSignal()
    );
    const initialState = observeInitialProcessState(child, startupSignal);

    child.stdout?.on('data', chunk => appendLog(config, record, 'stdout', chunk));
    child.stderr?.on('data', chunk => appendLog(config, record, 'stderr', chunk));
    child.once('spawn', () => {
      if (record.status !== 'starting') return;
      record.status = 'running';
      safePersistMetadata(config, record);
      addSpanEvent('process.spawned', { 'process.pid': record.pid || 0 });
    });
    child.once('error', error => finishRecord(config, record, {
      status: 'failed',
      exitCode: -1,
      error: error.message
    }));
    child.once('close', (code, signal) => finishRecord(config, record, {
      status: record.status === 'stopping' ? 'stopped' : (code === 0 ? 'exited' : 'failed'),
      exitCode: typeof code === 'number' ? code : -1,
      signal: signal || ''
    }));

    try {
      persistMetadata(config, record);
    } catch (error) {
      record.discarded = true;
      record.persistenceFailureHandled = true;
      clearScheduledPersist(record);
      await terminateProcessTree(child, { graceMs: 0, forceWaitMs: DEFAULT_FORCE_WAIT_MS }).catch(() => null);
      record.child = null;
      processes.delete(processId);
      fs.rmSync(directory, { recursive: true, force: true });
      throw new Error(`Could not persist managed process record: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }

    const initial = await initialState;
    if (initial.type === 'aborted') {
      await stopRecordInternal(config, record, { graceMs: DEFAULT_STOP_GRACE_MS });
      throw cancellationError('Managed process startup was cancelled before readiness was established.');
    }
    if (initial.type === 'error') {
      await cleanupFailedStartup(config, record);
      throw new Error(`Could not start managed process: ${initial.error?.message || 'spawn failed'}`);
    }
    if (initial.type === 'closed') {
      await cleanupFailedStartup(config, record);
      throw new Error(`Managed process exited during startup with code ${initial.code ?? -1}.`);
    }

    if (invocation.input !== undefined) {
      try {
        await writeInitialProcessInput(record, invocation.input);
      } catch (error) {
        await cleanupFailedStartup(config, record);
        throw new Error(`Could not send initial managed process input: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }

    const startupWaitMs = clampNumber(args.startupWaitMs, 0, 30000, DEFAULT_STARTUP_WAIT_MS);
    const startupResult = await waitDuringStartup(record, startupWaitMs, startupSignal);
    if (startupResult === 'aborted') {
      await stopRecordInternal(config, record, { graceMs: DEFAULT_STOP_GRACE_MS });
      throw cancellationError('Managed process startup was cancelled.');
    }
    if (startupResult === 'closed') {
      await cleanupFailedStartup(config, record);
      throw new Error(`Managed process exited during startup with code ${record.exitCode ?? -1}.`);
    }

    return {
      ...processSnapshot(record, { includeTail: true, tailBytes: 8192 }),
      reused: false,
      readiness: {
        verified: record.status === 'running',
        observedAt: new Date().toISOString(),
        waitedMs: startupWaitMs,
        status: record.status,
        stdoutBytes: record.stdoutBytes,
        stderrBytes: record.stderrBytes
      }
    };
  });
}

function observeInitialProcessState(child, signal) {
  return new Promise(resolve => {
    let settled = false;
    const onSpawn = () => finish({ type: 'spawned' });
    const onError = error => finish({ type: 'error', error });
    const onClose = (code, childSignal) => finish({ type: 'closed', code, signal: childSignal || '' });
    const onAbort = () => finish({ type: 'aborted' });

    child.once('spawn', onSpawn);
    child.once('error', onError);
    child.once('close', onClose);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener?.('abort', onAbort, { once: true });

    function finish(result) {
      if (settled) return;
      settled = true;
      child.off?.('spawn', onSpawn);
      child.off?.('error', onError);
      child.off?.('close', onClose);
      signal?.removeEventListener?.('abort', onAbort);
      resolve(result);
    }
  });
}

function waitDuringStartup(record, waitMs, signal) {
  if (signal?.aborted) return Promise.resolve('aborted');
  if (!ACTIVE_STATUSES.has(record.status)) return Promise.resolve('closed');
  if (waitMs <= 0) return Promise.resolve('ready');
  return new Promise(resolve => {
    let settled = false;
    const onClose = () => finish('closed');
    const onAbort = () => finish('aborted');
    const timer = setTimeout(() => finish('ready'), waitMs);
    record.child?.once?.('close', onClose);
    signal?.addEventListener?.('abort', onAbort, { once: true });

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      record.child?.off?.('close', onClose);
      signal?.removeEventListener?.('abort', onAbort);
      resolve(result);
    }
  });
}

function writeInitialProcessInput(record, input) {
  const stream = record.child?.stdin;
  if (!stream || stream.destroyed || !['starting', 'running'].includes(record.status)) {
    throw new Error(`Process ${record.processId} does not have writable stdin.`);
  }
  return new Promise((resolve, reject) => {
    stream.write(input, error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function appendLog(config, record, stream, chunk) {
  if (record.discarded || record.persistenceFailureHandled) return;
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  record.logBuffers[stream].push(buffer);
  record.logBufferBytes[stream] += buffer.length;
  if (record.logBufferBytes[stream] >= LOG_FLUSH_MAX_BYTES) {
    flushLogBuffer(config, record, stream);
    return;
  }
  scheduleLogFlush(config, record, stream);
}

function scheduleLogFlush(config, record, stream) {
  if (record.logFlushTimers[stream] || record.discarded || record.persistenceFailureHandled) return;
  record.logFlushTimers[stream] = setTimeout(() => {
    record.logFlushTimers[stream] = null;
    flushLogBuffer(config, record, stream);
  }, LOG_FLUSH_DELAY_MS);
  record.logFlushTimers[stream].unref?.();
}

function flushLogBuffer(config, record, stream) {
  clearScheduledLogFlush(record, stream);
  const chunks = record.logBuffers[stream];
  if (!chunks.length) return record.logWritePromises[stream];
  const buffer = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, record.logBufferBytes[stream]);
  record.logBuffers[stream] = [];
  record.logBufferBytes[stream] = 0;
  const file = stream === 'stdout' ? record.stdoutPath : record.stderrPath;
  const totalKey = `${stream}Bytes`;
  record.logWritePromises[stream] = record.logWritePromises[stream]
    .then(async () => {
      if (record.discarded) return;
      await fs.promises.appendFile(file, buffer);
      record[totalKey] += buffer.length;
      await trimLog(record, stream);
      scheduleMetadataPersist(config, record);
    })
    .catch(error => {
      handlePersistenceFailure(config, record, error);
    });
  return record.logWritePromises[stream];
}

async function trimLog(record, stream) {
  const file = stream === 'stdout' ? record.stdoutPath : record.stderrPath;
  const totalKey = `${stream}Bytes`;
  const startKey = `${stream}StartOffset`;
  const stat = await fs.promises.stat(file);
  if (stat.size <= record.maxLogBytes) return;
  const keep = Math.max(1, Math.floor(record.maxLogBytes * 0.75));
  const buffer = Buffer.allocUnsafe(keep);
  const handle = await fs.promises.open(file, 'r');
  try {
    await handle.read(buffer, 0, keep, stat.size - keep);
  } finally {
    await handle.close();
  }
  await fs.promises.writeFile(file, buffer, { mode: 0o600 });
  record[startKey] = Math.max(0, Number(record[totalKey] || 0) - keep);
}

function clearScheduledLogFlush(record, stream) {
  const timer = record.logFlushTimers?.[stream];
  if (!timer) return;
  clearTimeout(timer);
  record.logFlushTimers[stream] = null;
}

function clearScheduledLogFlushes(record) {
  clearScheduledLogFlush(record, 'stdout');
  clearScheduledLogFlush(record, 'stderr');
}

async function drainLogWrites(config, record) {
  flushLogBuffer(config, record, 'stdout');
  flushLogBuffer(config, record, 'stderr');
  await Promise.all([record.logWritePromises.stdout, record.logWritePromises.stderr]);
}

function readManagedProcess(config, args = {}, context = {}) {
  const record = requireProcess(config, args.processId);
  assertProcessAccess(config, record, args, context);
  const maxBytes = clampNumber(args.maxBytes, 1000, 1024 * 1024, 65536);
  const revision = processMetadataRevision(record);
  const includeMetadata = args.includeMetadata !== false
    && String(args.metadataRevision || '') !== revision;
  const output = {
    stdout: readLogRange(record, 'stdout', args.stdoutOffset, maxBytes),
    stderr: readLogRange(record, 'stderr', args.stderrOffset, maxBytes)
  };
  if (!includeMetadata) {
    return {
      ok: !['failed', 'orphaned'].includes(record.status),
      processId: record.processId,
      status: record.status,
      metadataRevision: revision,
      ...output
    };
  }
  return { ...processSnapshot(record), ...output };
}

function writeManagedProcess(config, args = {}, context = {}) {
  const record = requireProcess(config, args.processId);
  assertProcessAccess(config, record, args, context);
  if (!record.child || !record.child.stdin || record.child.stdin.destroyed || !['starting', 'running'].includes(record.status)) {
    throw new Error(`Process ${record.processId} does not have writable stdin.`);
  }
  const input = String(args.input ?? '');
  const bytes = Buffer.byteLength(input, 'utf8');
  if (bytes > 1024 * 1024) throw new Error('Process input exceeds 1 MiB.');
  record.child.stdin.write(input);
  return { ok: true, processId: record.processId, acceptedBytes: bytes, status: record.status };
}

async function stopManagedProcess(config, args = {}, context = {}) {
  const record = requireProcess(config, args.processId);
  assertProcessAccess(config, record, args, context);
  const duplicate = TERMINAL_STATUSES.has(record.status) && !isProcessTreeAlive(record.pid);
  if (!duplicate) {
    await stopRecordInternal(config, record, {
      graceMs: clampNumber(args.graceMs, 0, 30000, DEFAULT_STOP_GRACE_MS)
    });
  }
  return {
    ...processSnapshot(record, { includeTail: true, tailBytes: 8192 }),
    duplicate
  };
}

async function stopRecordInternal(config, record, options = {}) {
  const target = record.child || record.pid;
  if (!target || !isProcessTreeAlive(target)) {
    if (!TERMINAL_STATUSES.has(record.status)) {
      finishRecord(config, record, {
        status: 'stopped',
        exitCode: record.exitCode,
        signal: record.signal || 'unobserved'
      });
    }
    await drainLogWrites(config, record);
    return processSnapshot(record);
  }

  record.status = 'stopping';
  safePersistMetadata(config, record);
  const outcome = await terminateProcessTree(target, {
    graceMs: clampNumber(options.graceMs, 0, 30000, DEFAULT_STOP_GRACE_MS),
    forceWaitMs: DEFAULT_FORCE_WAIT_MS
  });

  if (!outcome.exited) {
    record.status = 'orphaned';
    record.error = 'Managed process termination could not be confirmed.';
    safePersistMetadata(config, record);
  } else if (record.status === 'stopping') {
    finishRecord(config, record, {
      status: 'stopped',
      exitCode: typeof record.exitCode === 'number' ? record.exitCode : -1,
      signal: outcome.forced ? 'SIGKILL' : 'SIGTERM'
    });
  }
  await drainLogWrites(config, record);
  return processSnapshot(record);
}

function listManagedProcesses(config, args = {}, context = {}) {
  hydrateProcessMetadata(config);
  pruneManagedProcesses(config);
  const requestedWorkspace = resolveCallerWorkspace(config, args, context);
  assertRequestedWorkspaceBoundary(config, args, context, requestedWorkspace);
  const status = String(args.status || '').trim();
  const explicitTerminalStatus = TERMINAL_STATUSES.has(status);
  const includeTerminal = args.includeTerminal === true || explicitTerminalStatus;
  const activeOnly = args.activeOnly !== false && !includeTerminal;
  const items = [...processes.values()]
    .filter(item => canAccessProcess(config, item, args, context))
    .filter(item => !requestedWorkspace || workspaceMatches(item, requestedWorkspace))
    .filter(item => !status || item.status === status)
    .filter(item => !activeOnly || ACTIVE_STATUSES.has(item.status) || item.status === 'orphaned')
    .filter(item => includeTerminal || !TERMINAL_STATUSES.has(item.status))
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    .slice(0, clampNumber(args.limit, 1, 500, 100))
    .map(item => processSnapshot(item));
  return { ok: true, processes: items, count: items.length };
}

function assertProcessAccess(config, record, args = {}, context = {}) {
  if (trustedLocalContext(args, context)) return;
  const actualPrincipalKey = principalKeyForContext(context);
  if ((!record.principalKey && context.connector === true)
    || (record.principalKey && actualPrincipalKey !== record.principalKey)) {
    throw taskError('PROCESS_ACCESS_DENIED', 'Managed process is not available to this caller.');
  }

  const callerWorkspace = resolveCallerWorkspace(config, args, context);
  if (callerWorkspace && !workspaceMatches(record, callerWorkspace)) {
    throw taskError('PROCESS_WORKSPACE_MISMATCH', 'Managed process belongs to a different workspace.');
  }
  if (!callerWorkspace && context.connector === true) {
    throw taskError('PROCESS_WORKSPACE_CONTEXT_REQUIRED', 'Managed process access requires a workspace-bound logical task.');
  }

  const workSessionId = String(context.taskId || args.work_id || '').trim();
  if (record.status === 'starting' && record.workSessionId && workSessionId && record.workSessionId !== workSessionId) {
    throw taskError('PROCESS_SESSION_MISMATCH', 'Managed process startup belongs to a different work session.');
  }
}

function canAccessProcess(config, record, args, context) {
  try {
    assertProcessAccess(config, record, args, context);
    return true;
  } catch {
    return false;
  }
}

function assertRequestedWorkspaceBoundary(config, args, context, requestedWorkspace) {
  const explicit = String(args.workspace || '').trim();
  const sessionWorkspace = String(
    context.workspace || workSessionWorkspace(config, context.taskId || args.work_id) || ''
  ).trim();
  if (explicit && sessionWorkspace && !sameWorkspaceReference(explicit, sessionWorkspace)) {
    throw taskError('PROCESS_WORKSPACE_MISMATCH', 'Requested process workspace differs from the logical task workspace.');
  }
  if (context.connector === true && !requestedWorkspace) {
    throw taskError('PROCESS_WORKSPACE_CONTEXT_REQUIRED', 'Managed process listing requires a workspace-bound logical task.');
  }
}

function resolveCallerWorkspace(config, args = {}, context = {}) {
  return String(
    args.workspace
    || context.workspace
    || workSessionWorkspace(config, context.taskId || args.work_id)
    || ''
  ).trim();
}

function workSessionWorkspace(config, taskId) {
  const id = String(taskId || '').trim();
  if (!id) return '';
  return String(readTaskHistorySession(config, id)?.workspace || '').trim();
}

function managedProcessReuseFingerprint({ workspaceId = '', workSessionId = '', principalKey = '', executionMode = '', command = '', input = '', cwd = '.', kind = '', purpose = '', environmentKeys = [] } = {}) {
  return crypto.createHash('sha256').update(JSON.stringify([
    normalizeWorkspaceReference(workspaceId),
    String(workSessionId || '').trim(),
    String(principalKey || '').trim(),
    String(executionMode || '').trim(),
    String(command || '').trim(),
    String(input || ''),
    String(cwd || '.').trim().replaceAll('\\', '/'),
    String(kind || '').trim().toLowerCase(),
    String(purpose || '').trim(),
    [...new Set((environmentKeys || []).map(value => String(value || '').trim()).filter(Boolean))].sort()
  ])).digest('base64url');
}

function findReusableManagedProcess(reuseFingerprint) {
  if (!reuseFingerprint) return null;
  return [...processes.values()].find(record =>
    record.reuseFingerprint === reuseFingerprint
    && ['starting', 'running'].includes(record.status)
    && record.lifecycle === 'persistent'
    && !record.discarded
  ) || null;
}
function principalKeyForContext(context = {}) {
  const authInfo = context.mcp?.authInfo || context.authInfo || {};
  const authExtra = authInfo?.extra && typeof authInfo.extra === 'object' ? authInfo.extra : {};
  const principal = String(
    context.principal
    || authInfo.clientId
    || authInfo.client_id
    || authExtra.clientId
    || authExtra.client_id
    || context.requestHeaders?.authorization
    || (context.connector === true ? 'connector:anonymous' : context.taskId ? 'local:stdio' : '')
    || ''
  ).trim();
  if (!principal) return '';
  return crypto.createHash('sha256').update(`relai-process-principal\0${principal}`).digest('base64url');
}

function trustedLocalContext(args = {}, context = {}) {
  return context.internal === true
    || (Object.keys(context).length === 0 && !args.work_id && !args.taskId && !args.workspace);
}

function workspaceMatches(record, workspace) {
  const expected = normalizeWorkspaceReference(workspace);
  return expected === normalizeWorkspaceReference(record.workspaceId)
    || expected === normalizeWorkspaceReference(record.workspacePath);
}

function sameWorkspaceReference(left, right) {
  return normalizeWorkspaceReference(left) === normalizeWorkspaceReference(right);
}

function normalizeWorkspaceReference(value) {
  const text = String(value || '').trim();
  return process.platform === 'win32' ? text.toLowerCase() : text;
}

function processSnapshot(record, options = {}) {
  const result = {
    ok: !['failed', 'orphaned'].includes(record.status),
    processId: record.processId,
    pid: record.pid || null,
    workspace: record.workspaceId,
    workspaceId: record.workspaceId,
    label: record.label,
    kind: record.kind || 'service',
    purpose: record.purpose || '',
    commandSummary: record.commandSummary,
    cwd: record.cwd,
    status: record.status,
    metadataRevision: processMetadataRevision(record),
    lifecycle: record.lifecycle || 'persistent',
    originatingTaskId: record.originatingTaskId || null,
    workSessionId: record.workSessionId || null,
    startedAt: record.startedAt,
    endedAt: record.endedAt || null,
    exitCode: record.exitCode,
    signal: record.signal || null,
    stdoutBytes: Number(record.stdoutBytes || 0),
    stderrBytes: Number(record.stderrBytes || 0),
    stdoutRetainedFromOffset: Number(record.stdoutStartOffset || 0),
    stderrRetainedFromOffset: Number(record.stderrStartOffset || 0),
    environmentKeys: record.environmentKeys || []
  };
  if (record.error) result.error = record.error;
  if (options.includeTail) {
    result.stdoutTail = readLogTail(record, 'stdout', options.tailBytes || 8192);
    result.stderrTail = readLogTail(record, 'stderr', options.tailBytes || 8192);
  }
  return result;
}

function processMetadataRevision(record) {
  return crypto.createHash('sha256').update(JSON.stringify([
    record.status,
    record.pid || null,
    record.endedAt || '',
    record.exitCode,
    record.signal || '',
    record.error || ''
  ])).digest('base64url').slice(0, 16);
}

function finishRecord(config, record, fields) {
  if (TERMINAL_STATUSES.has(record.status) && record.endedAt) return;
  clearScheduledPersist(record);
  Object.assign(record, fields, { endedAt: new Date().toISOString() });
  record.child = null;
  if (!record.discarded) {
    void drainLogWrites(config, record).then(() => queueMetadataPersist(config, record));
  }
}

function requireProcess(config, processId) {
  const id = validateProcessId(processId);
  let record = processes.get(id);
  if (!record) {
    record = readMetadata(config, id);
    if (!record) throw new Error(`Unknown managed process: ${id}`);
    reconcileRestoredRecord(config, record);
    processes.set(id, record);
  }
  return record;
}

function persistMetadata(config, record) {
  const directory = processDirectory(config, record.processId);
  const target = path.join(directory, 'metadata.json');
  writeJsonAtomic(target, metadataRecord(record), { mode: 0o600, backup: true });
}

function persistMetadataAsync(config, record) {
  const directory = processDirectory(config, record.processId);
  const target = path.join(directory, 'metadata.json');
  return writeJsonAtomicAsync(target, metadataRecord(record), { mode: 0o600, backup: true, durable: false });
}

function queueMetadataPersist(config, record) {
  if (record.discarded || record.persistenceFailureHandled) return Promise.resolve(false);
  const previous = metadataWriteQueues.get(record.processId) || Promise.resolve();
  const next = previous
    .then(() => persistMetadataAsync(config, record))
    .then(() => true)
    .catch(error => {
      handlePersistenceFailure(config, record, error);
      return false;
    })
    .finally(() => {
      if (metadataWriteQueues.get(record.processId) === next) metadataWriteQueues.delete(record.processId);
    });
  metadataWriteQueues.set(record.processId, next);
  return next;
}

function metadataRecord(record) {
  return {
    schemaVersion: PROCESS_SCHEMA_VERSION,
    runtimeId: record.runtimeId || RUNTIME_ID,
    processId: record.processId,
    workspaceId: record.workspaceId,
    workspacePath: record.workspacePath,
    originatingTaskId: record.originatingTaskId || '',
    workSessionId: record.workSessionId || '',
    principalKey: record.principalKey || '',
    reuseFingerprint: record.reuseFingerprint || '',
    lifecycle: record.lifecycle || 'persistent',
    kind: record.kind || 'service',
    purpose: record.purpose || '',
    commandSummary: record.commandSummary,
    label: record.label,
    cwd: record.cwd,
    status: record.status,
    startedAt: record.startedAt,
    endedAt: record.endedAt || '',
    exitCode: record.exitCode,
    signal: record.signal || '',
    error: record.error || '',
    pid: record.pid || null,
    stdoutBytes: Number(record.stdoutBytes || 0),
    stderrBytes: Number(record.stderrBytes || 0),
    stdoutStartOffset: Number(record.stdoutStartOffset || 0),
    stderrStartOffset: Number(record.stderrStartOffset || 0),
    environmentKeys: record.environmentKeys || [],
    maxLogBytes: record.maxLogBytes
  };
}

function safePersistMetadata(config, record) {
  if (record.discarded) return false;
  try {
    persistMetadata(config, record);
    return true;
  } catch (error) {
    handlePersistenceFailure(config, record, error);
    return false;
  }
}

function scheduleMetadataPersist(config, record) {
  if (record.persistTimer || record.persistenceFailureHandled) return;
  record.persistTimer = setTimeout(() => {
    record.persistTimer = null;
    void queueMetadataPersist(config, record);
  }, METADATA_FLUSH_DELAY_MS);
  record.persistTimer.unref?.();
}

function clearScheduledPersist(record) {
  if (!record.persistTimer) return;
  clearTimeout(record.persistTimer);
  record.persistTimer = null;
}

function handlePersistenceFailure(config, record, error) {
  if (record.persistenceFailureHandled) return;
  record.persistenceFailureHandled = true;
  clearScheduledPersist(record);
  clearScheduledLogFlushes(record);
  record.error = `Managed process persistence failed: ${error instanceof Error ? error.message : String(error)}`;
  const target = record.child || record.pid;
  void terminateProcessTree(target, { graceMs: 0, forceWaitMs: DEFAULT_FORCE_WAIT_MS })
    .then(outcome => {
      record.status = outcome.exited ? 'failed' : 'orphaned';
      if (outcome.exited) record.endedAt = new Date().toISOString();
      record.child = null;
      try { persistMetadata(config, record); } catch {}
    })
    .catch(() => {
      record.status = 'orphaned';
      record.child = null;
    });
}

function readMetadata(config, processId) {
  try {
    const directory = processDirectory(config, processId);
    const metadata = readJsonFile(path.join(directory, 'metadata.json'), { backup: true });
    if (!metadata || metadata.processId !== processId) return null;
    const stdoutPath = path.join(directory, 'stdout.log');
    const stderrPath = path.join(directory, 'stderr.log');
    const stdoutSize = fileSize(stdoutPath);
    const stderrSize = fileSize(stderrPath);
    const stdoutBytes = Math.max(Number(metadata.stdoutBytes || 0), Number(metadata.stdoutStartOffset || 0) + stdoutSize);
    const stderrBytes = Math.max(Number(metadata.stderrBytes || 0), Number(metadata.stderrStartOffset || 0) + stderrSize);
    return {
      schemaVersion: PROCESS_SCHEMA_VERSION,
      runtimeId: String(metadata.runtimeId || ''),
      processId,
      workspaceId: String(metadata.workspaceId || metadata.workspace || ''),
      workspacePath: String(metadata.workspacePath || ''),
      originatingTaskId: String(metadata.originatingTaskId || ''),
      workSessionId: String(metadata.workSessionId || metadata.logicalTaskId || ''),
      principalKey: String(metadata.principalKey || ''),
      lifecycle: String(metadata.lifecycle || 'persistent'),
      kind: ['service', 'watcher', 'interactive'].includes(String(metadata.kind || '')) ? String(metadata.kind) : 'service',
      purpose: String(metadata.purpose || ''),
      commandSummary: String(metadata.commandSummary || ''),
      label: String(metadata.label || metadata.commandSummary || processId),
      cwd: String(metadata.cwd || '.'),
      status: String(metadata.status || 'orphaned'),
      startedAt: String(metadata.startedAt || ''),
      endedAt: String(metadata.endedAt || ''),
      exitCode: typeof metadata.exitCode === 'number' ? metadata.exitCode : null,
      signal: String(metadata.signal || ''),
      error: String(metadata.error || ''),
      pid: Number.isSafeInteger(Number(metadata.pid)) ? Number(metadata.pid) : null,
      stdoutBytes,
      stderrBytes,
      stdoutStartOffset: Number.isFinite(Number(metadata.stdoutStartOffset))
        ? Number(metadata.stdoutStartOffset)
        : Math.max(0, stdoutBytes - stdoutSize),
      stderrStartOffset: Number.isFinite(Number(metadata.stderrStartOffset))
        ? Number(metadata.stderrStartOffset)
        : Math.max(0, stderrBytes - stderrSize),
      stdoutPath,
      stderrPath,
      environmentKeys: Array.isArray(metadata.environmentKeys) ? metadata.environmentKeys : [],
      child: null,
      maxLogBytes: clampNumber(metadata.maxLogBytes, 65536, 256 * 1024 * 1024, DEFAULT_MAX_LOG_BYTES),
      persistTimer: null,
      logBuffers: { stdout: [], stderr: [] },
      logBufferBytes: { stdout: 0, stderr: 0 },
      logFlushTimers: { stdout: null, stderr: null },
      logWritePromises: { stdout: Promise.resolve(), stderr: Promise.resolve() },
      persistenceFailureHandled: false,
      discarded: false
    };
  } catch {
    return null;
  }
}

function reconcileRestoredRecord(config, record) {
  if (record.runtimeId === RUNTIME_ID && processes.has(record.processId)) return record;
  if (![...ACTIVE_STATUSES, 'orphaned'].includes(record.status)) return record;
  if (record.pid && isProcessTreeAlive(record.pid)) {
    record.status = 'orphaned';
    record.error = record.error || 'Process survived a Rel.AI restart; live pipes and stdin cannot be reattached.';
  } else {
    record.status = 'stopped';
    record.endedAt = record.endedAt || new Date().toISOString();
    record.signal = record.signal || 'unobserved_restart';
  }
  try { persistMetadata(config, record); } catch {}
  return record;
}

function hydrateProcessMetadata(config) {
  const root = processRoot(config);
  const now = Date.now();
  if (now - Number(metadataScanAt.get(root) || 0) < METADATA_RESCAN_INTERVAL_MS) return;
  metadataScanAt.set(root, now);
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || processes.has(entry.name)) continue;
    const record = readMetadata(config, entry.name);
    if (!record) continue;
    reconcileRestoredRecord(config, record);
    processes.set(entry.name, record);
  }
}

function readLogRange(record, stream, offsetValue, maxBytes) {
  const file = stream === 'stdout' ? record.stdoutPath : record.stderrPath;
  const totalBytes = Number(record[`${stream}Bytes`] || 0);
  const retainedFromOffset = Number(record[`${stream}StartOffset`] || 0);
  const requestedOffset = Math.max(0, Number(offsetValue) || 0);
  const offset = Math.min(totalBytes, Math.max(retainedFromOffset, requestedOffset));
  try {
    const stat = fs.statSync(file);
    const fileOffset = Math.min(stat.size, Math.max(0, offset - retainedFromOffset));
    const length = Math.min(maxBytes, stat.size - fileOffset, totalBytes - offset);
    const buffer = Buffer.alloc(Math.max(0, length));
    if (length > 0) {
      const fd = fs.openSync(file, 'r');
      try { fs.readSync(fd, buffer, 0, length, fileOffset); } finally { fs.closeSync(fd); }
    }
    const decoded = decodeLogBuffer(buffer);
    return {
      requestedOffset,
      offset,
      nextOffset: offset + length,
      totalBytes,
      retainedFromOffset,
      truncatedBefore: requestedOffset < retainedFromOffset,
      truncated: offset + length < totalBytes,
      text: decoded.text,
      encoding: 'utf8',
      ...(decoded.invalidUtf8 ? { invalidUtf8: true, base64: buffer.toString('base64') } : {})
    };
  } catch {
    return {
      requestedOffset,
      offset: retainedFromOffset,
      nextOffset: retainedFromOffset,
      totalBytes,
      retainedFromOffset,
      truncatedBefore: requestedOffset < retainedFromOffset,
      truncated: retainedFromOffset < totalBytes,
      text: '',
      encoding: 'utf8'
    };
  }
}

function decodeLogBuffer(buffer) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), invalidUtf8: false };
  } catch {
    return { text: buffer.toString('utf8'), invalidUtf8: true };
  }
}

function readLogTail(record, stream, maxBytes) {
  const totalBytes = Number(record[`${stream}Bytes`] || 0);
  const start = Math.max(Number(record[`${stream}StartOffset`] || 0), totalBytes - maxBytes);
  return readLogRange(record, stream, start, maxBytes).text;
}

function fileSize(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

function activeProcessesForWorkspace(config, workspaceAlias) {
  hydrateProcessMetadata(config);
  return [...processes.values()].filter(item => workspaceMatches(item, workspaceAlias)
    && processNeedsTermination(item));
}

async function stopAllManagedProcesses(config) {
  hydrateProcessMetadata(config);
  const active = [...processes.values()].filter(processNeedsTermination);
  const results = await Promise.all(active.map(item => stopManagedProcess(config, {
    processId: item.processId,
    graceMs: 1000
  }, { internal: true }).catch(() => null)));
  return {
    stopped: results.filter(item => item && TERMINAL_STATUSES.has(item.status)).length,
    attempted: active.length,
    orphaned: results.filter(item => item?.status === 'orphaned').length
  };
}

function pruneManagedProcesses(config) {
  const root = processRoot(config);
  const now = Date.now();
  if (now - Number(metadataPruneAt.get(root) || 0) < METADATA_PRUNE_INTERVAL_MS) return { removed: 0 };
  metadataPruneAt.set(root, now);
  if (!fs.existsSync(root)) return { removed: 0 };
  let removed = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const record = processes.get(entry.name) || readMetadata(config, entry.name);
    if (!record) continue;
    reconcileRestoredRecord(config, record);
    const timestamp = Date.parse(record.endedAt || record.startedAt || 0);
    if (TERMINAL_STATUSES.has(record.status) && Date.now() - timestamp > RECENT_RETENTION_MS) {
      fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
      processes.delete(entry.name);
      removed += 1;
    }
  }
  return { removed };
}

async function cleanupFailedStartup(config, record) {
  const target = record.child || record.pid;
  if (!target) {
    await drainLogWrites(config, record);
    return { exited: true, forced: false };
  }
  const outcome = await terminateProcessTree(target, {
    graceMs: 0,
    forceWaitMs: DEFAULT_FORCE_WAIT_MS
  });
  if (!outcome.exited) {
    record.status = 'orphaned';
    record.error = 'Managed process startup failed and descendant termination could not be confirmed.';
    safePersistMetadata(config, record);
  }
  await drainLogWrites(config, record);
  return outcome;
}

function processNeedsTermination(record) {
  if (ACTIVE_STATUSES.has(record.status)) return true;
  if (record.status === 'orphaned') return isProcessTreeAlive(record.pid);
  return TERMINAL_STATUSES.has(record.status)
    && record.runtimeId === RUNTIME_ID
    && isProcessTreeAlive(record.pid);
}

function cancellationError(message) {
  const error = taskError('TASK_CANCELLED', message);
  error.cancelled = true;
  return error;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

export {
  activeProcessesForWorkspace,
  listManagedProcesses,
  pruneManagedProcesses,
  readManagedProcess,
  startManagedProcess,
  stopAllManagedProcesses,
  stopManagedProcess,
  writeManagedProcess
};
