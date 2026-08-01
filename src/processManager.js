
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { getStateDir } from './statePaths.js';
import { resolveCommandCwd, normalizeCommandEnv, resolveShell, redactCommandForAudit } from './bridge/exec.js';
import { killProcessTree } from './process.js';
import { makeProcessEnvironment } from './processEnvironment.js';
import { runSpan, addSpanEvent, traceContextEnvironment } from './telemetry.js';
import { taskError } from './toolActivity.js';
const processes = new Map();
const RECENT_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_LOG_BYTES = 16 * 1024 * 1024;

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
  const command = String(args.command || '').trim();
  if (!command) throw new Error('relai_process_start requires command.');
  if (command.length > 20000) throw new Error('relai_process_start command must be 20000 characters or fewer.');
  const cwd = resolveCommandCwd(workspace, args.cwd);
  const env = normalizeCommandEnv(args.env);
  const shell = resolveShell();
  const processId = `proc_${crypto.randomBytes(24).toString('base64url')}`;
  const directory = processDirectory(config, processId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stdoutPath = path.join(directory, 'stdout.log');
  const stderrPath = path.join(directory, 'stderr.log');
  fs.writeFileSync(stdoutPath, '', { mode: 0o600 });
  fs.writeFileSync(stderrPath, '', { mode: 0o600 });
  const record = {
    processId,
    workspace: workspace.alias,
    workspacePath: workspace.path,
    logicalTaskId: String(context.taskId || args.task_id || ''),
    command,
    commandSummary: redactCommandForAudit(command),
    label: String(args.label || '').trim().slice(0, 120) || redactCommandForAudit(command),
    cwd: cwd.relativePath,
    status: 'starting',
    startedAt: new Date().toISOString(),
    endedAt: '',
    exitCode: null,
    signal: '',
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutPath,
    stderrPath,
    environmentKeys: Object.keys(env).sort(),
    child: null,
    maxLogBytes: clampNumber(args.maxLogBytes, 65536, 256 * 1024 * 1024, DEFAULT_MAX_LOG_BYTES)
  };

  return runSpan(config, 'relai.process.start', {
    'relai.process.id': processId,
    'relai.workspace': workspace.alias,
    'relai.process.command': record.commandSummary,
    'relai.task.id': record.logicalTaskId
  }, async () => {
    const childEnvironment = makeProcessEnvironment(env, { allow: config.processEnvironment?.allow });
    Object.assign(childEnvironment, traceContextEnvironment());
    const child = spawn(shell.executable, shell.args(command), {
      cwd: cwd.absolutePath,
      env: childEnvironment,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    record.child = child;
    record.pid = child.pid || null;
    processes.set(processId, record);
    persistMetadata(config, record);
    child.stdout?.on('data', chunk => appendLog(config, record, 'stdout', chunk));
    child.stderr?.on('data', chunk => appendLog(config, record, 'stderr', chunk));
    child.once('spawn', () => {
      record.status = 'running';
      persistMetadata(config, record);
      addSpanEvent('process.spawned', { 'process.pid': record.pid || 0 });
    });
    child.once('error', error => finishRecord(config, record, { status: 'failed', exitCode: -1, error: error.message }));
    child.once('close', (code, signal) => finishRecord(config, record, {
      status: record.status === 'stopping' ? 'stopped' : (code === 0 ? 'exited' : 'failed'),
      exitCode: typeof code === 'number' ? code : -1,
      signal: signal || ''
    }));
    const startupWaitMs = clampNumber(args.startupWaitMs, 0, 30000, 750);
    if (startupWaitMs > 0) await new Promise(resolve => setTimeout(resolve, startupWaitMs));
    return processSnapshot(record, { includeTail: true, tailBytes: 8192 });
  });
}

function appendLog(config, record, stream, chunk) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  const file = stream === 'stdout' ? record.stdoutPath : record.stderrPath;
  fs.appendFileSync(file, buffer);
  record[`${stream}Bytes`] += buffer.length;
  trimLog(file, record.maxLogBytes);
  persistMetadata(config, record);
}

function trimLog(file, maxBytes) {
  try {
    const stat = fs.statSync(file);
    if (stat.size <= maxBytes) return;
    const keep = Math.floor(maxBytes * 0.75);
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.allocUnsafe(keep);
    fs.readSync(fd, buffer, 0, keep, stat.size - keep);
    fs.closeSync(fd);
    fs.writeFileSync(file, Buffer.concat([Buffer.from('[older process output removed]\n'), buffer]), { mode: 0o600 });
  } catch {}
}

function readManagedProcess(config, args = {}, context = {}) {
  const record = requireProcess(config, args.processId);
  assertProcessTaskOwner(record, args, context);
  const maxBytes = clampNumber(args.maxBytes, 1000, 1024 * 1024, 65536);
  return {
    ...processSnapshot(record),
    stdout: readLogRange(record.stdoutPath, args.stdoutOffset, maxBytes),
    stderr: readLogRange(record.stderrPath, args.stderrOffset, maxBytes)
  };
}

function writeManagedProcess(config, args = {}, context = {}) {
  const record = requireProcess(config, args.processId);
  assertProcessTaskOwner(record, args, context);
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
  assertProcessTaskOwner(record, args, context);
  if (!record.child || !['starting', 'running', 'stopping'].includes(record.status)) return processSnapshot(record);
  record.status = 'stopping';
  persistMetadata(config, record);
  killProcessTree(record.child);
  const graceMs = clampNumber(args.graceMs, 0, 30000, 3000);
  if (graceMs > 0 && record.status === 'stopping') await new Promise(resolve => setTimeout(resolve, Math.min(graceMs, 5000)));
  if (record.status === 'stopping') finishRecord(config, record, { status: 'stopped', exitCode: -1, signal: 'SIGTERM' });
  return processSnapshot(record, { includeTail: true, tailBytes: 8192 });
}

function listManagedProcesses(config, args = {}, context = {}) {
  hydrateProcessMetadata(config);
  pruneManagedProcesses(config);
  const workspace = String(args.workspace || '').trim();
  const status = String(args.status || '').trim();
  const logicalTaskId = String(context.taskId || args.task_id || '').trim();
  const items = [...processes.values()]
    .filter(item => !logicalTaskId || item.logicalTaskId === logicalTaskId)
    .filter(item => !workspace || item.workspace === workspace)
    .filter(item => !status || item.status === status)
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    .slice(0, clampNumber(args.limit, 1, 500, 100))
    .map(item => processSnapshot(item));
  return { ok: true, processes: items, count: items.length };
}

function assertProcessTaskOwner(record, args = {}, context = {}) {
  const expected = String(record.logicalTaskId || '').trim();
  const actual = String(context.taskId || args.task_id || '').trim();
  if (expected && actual !== expected) {
    throw taskError('TASK_OWNERSHIP_MISMATCH', 'The managed process belongs to a different logical task.');
  }
}

function processSnapshot(record, options = {}) {
  const result = {
    ok: !['failed'].includes(record.status),
    processId: record.processId,
    pid: record.pid || null,
    workspace: record.workspace,
    label: record.label,
    commandSummary: record.commandSummary,
    cwd: record.cwd,
    status: record.status,
    startedAt: record.startedAt,
    endedAt: record.endedAt || null,
    exitCode: record.exitCode,
    signal: record.signal || null,
    stdoutBytes: record.stdoutBytes,
    stderrBytes: record.stderrBytes,
    environmentKeys: record.environmentKeys || []
  };
  if (record.error) result.error = record.error;
  if (options.includeTail) {
    result.stdoutTail = readLogTail(record.stdoutPath, options.tailBytes || 8192);
    result.stderrTail = readLogTail(record.stderrPath, options.tailBytes || 8192);
  }
  return result;
}

function finishRecord(config, record, fields) {
  if (['exited', 'failed', 'stopped'].includes(record.status) && record.endedAt) return;
  Object.assign(record, fields, { endedAt: new Date().toISOString() });
  record.child = null;
  persistMetadata(config, record);
}

function requireProcess(config, processId) {
  const id = validateProcessId(processId);
  let record = processes.get(id);
  if (!record) {
    record = readMetadata(config, id);
    if (!record) throw new Error(`Unknown managed process: ${id}`);
    if (['starting', 'running', 'stopping'].includes(record.status)) record.status = 'orphaned';
    processes.set(id, record);
  }
  return record;
}

function persistMetadata(config, record) {
  const directory = processDirectory(config, record.processId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const metadata = { ...record };
  delete metadata.child;
  delete metadata.command;
  fs.writeFileSync(path.join(directory, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
}

function readMetadata(config, processId) {
  try {
    const directory = processDirectory(config, processId);
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'metadata.json'), 'utf8'));
    return {
      ...metadata,
      stdoutPath: path.join(directory, 'stdout.log'),
      stderrPath: path.join(directory, 'stderr.log'),
      child: null
    };
  } catch {
    return null;
  }
}

function hydrateProcessMetadata(config) {
  const root = processRoot(config);
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || processes.has(entry.name)) continue;
    try { requireProcess(config, entry.name); } catch {}
  }
}

function readLogRange(file, offsetValue, maxBytes) {
  try {
    const stat = fs.statSync(file);
    const offset = Math.min(stat.size, Math.max(0, Number(offsetValue) || 0));
    const length = Math.min(maxBytes, stat.size - offset);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buffer, 0, length, offset);
    fs.closeSync(fd);
    return { offset, nextOffset: offset + length, totalBytes: stat.size, truncated: offset + length < stat.size, text: buffer.toString('utf8').replace(/^\uFFFD+/u, '') };
  } catch {
    return { offset: 0, nextOffset: 0, totalBytes: 0, truncated: false, text: '' };
  }
}

function readLogTail(file, maxBytes) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    return readLogRange(file, start, maxBytes).text;
  } catch {
    return '';
  }
}

function activeProcessesForWorkspace(config, workspaceAlias) {
  hydrateProcessMetadata(config);
  return [...processes.values()].filter(item => item.workspace === workspaceAlias && ['starting', 'running', 'stopping'].includes(item.status));
}

async function stopAllManagedProcesses(config) {
  hydrateProcessMetadata(config);
  const active = [...processes.values()].filter(item => ['starting', 'running', 'stopping'].includes(item.status));
  await Promise.all(active.map(item => stopManagedProcess(config, { processId: item.processId, graceMs: 1000 }).catch(() => null)));
  return { stopped: active.length };
}

function pruneManagedProcesses(config) {
  const root = processRoot(config);
  if (!fs.existsSync(root)) return { removed: 0 };
  let removed = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const record = readMetadata(config, entry.name);
    const timestamp = Date.parse(record?.endedAt || record?.startedAt || 0);
    if (record && !['starting', 'running', 'stopping', 'orphaned'].includes(record.status) && Date.now() - timestamp > RECENT_RETENTION_MS) {
      fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
      processes.delete(entry.name);
      removed += 1;
    }
  }
  return { removed };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

export { startManagedProcess, readManagedProcess, writeManagedProcess, stopManagedProcess, listManagedProcesses, activeProcessesForWorkspace, stopAllManagedProcesses, pruneManagedProcesses };
