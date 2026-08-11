// @ts-check

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';
import { runProcess } from '../process.js';
import { nativeToolTaskSignal } from '../mcp/nativeToolTasks.js';
import { getCurrentTaskAbortSignal } from '../toolActivity.js';
import { combineAbortSignals } from '../abortSignals.js';
import { runSpan } from '../telemetry.js';
import { isPathInside } from '../safety.js';
import { INTERNAL_STATUS_MAX_BYTES, gitStatusArgs, statusMapFromOutput } from '../repo/gitStatus.js';
const WHERE_EXE = String.raw`C:\Windows\System32\where.exe`;
const MAX_CHANGED_FILES = 200;
const MAX_DIRECT_ARGV_ITEMS = 100;
const MAX_DIRECT_ARG_LENGTH = 20000;
const MAX_DIRECT_INPUT_LENGTH = 1024 * 1024;
/** @typedef {{ executable: string, label: string, args: (command: string) => string[] }} CommandHost */
/** @type {CommandHost | null} */
let cachedShell = null;

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function resolveCommandCwd(workspace, value) {
  const raw = String(value == null || value === '' ? '.' : value).trim() || '.';
  if (path.isAbsolute(raw)) throw new Error('relai_exec cwd must be relative to the configured workspace.');
  const root = fs.realpathSync(workspace.path);
  const candidate = path.resolve(root, raw);
  if (!isPathInside(candidate, root)) throw new Error(`relai_exec cwd escapes the workspace: ${raw}`);
  if (!fs.existsSync(candidate)) throw new Error(`relai_exec cwd does not exist: ${raw}`);
  const real = fs.realpathSync(candidate);
  if (!isPathInside(real, root)) throw new Error(`relai_exec cwd resolves outside the workspace: ${raw}`);
  if (!fs.statSync(real).isDirectory()) throw new Error(`relai_exec cwd is not a directory: ${raw}`);
  const relative = path.relative(root, real).replaceAll(path.sep, '/') || '.';
  return { absolutePath: real, relativePath: relative };
}

function normalizeCommandEnv(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('relai_exec env must be an object of string values.');
  const env = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key || key.includes('=') || key.includes('\0')) throw new Error(`relai_exec env contains an invalid key: ${key || '(empty)'}`);
    if (typeof item !== 'string') throw new Error(`relai_exec env value for ${key} must be a string.`);
    if (item.includes('\0')) throw new Error(`relai_exec env value for ${key} contains a null byte.`);
    env[key] = item;
  }
  return env;
}

function normalizeDirectArgv(value, operationName = 'relai_exec') {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${operationName} argv must be an array of strings.`);
  if (value.length > MAX_DIRECT_ARGV_ITEMS) throw new Error(`${operationName} argv supports at most 100 items.`);
  return value.map((item, index) => {
    if (typeof item !== 'string') throw new Error(`${operationName} argv[${index}] must be a string.`);
    if (item.length > MAX_DIRECT_ARG_LENGTH) throw new Error(`${operationName} argv[${index}] must be 20000 characters or fewer.`);
    if (item.includes('\0')) throw new Error(`${operationName} argv[${index}] contains a null byte.`);
    return item;
  });
}

function normalizeDirectInput(value, operationName = 'relai_exec') {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new Error(`${operationName} input must be a string.`);
  if (value.length > MAX_DIRECT_INPUT_LENGTH) throw new Error(`${operationName} input must be 1048576 characters or fewer.`);
  return value;
}

function directCommandSummary(executable, argv) {
  return [executable, ...argv].map(value => JSON.stringify(String(value))).join(' ');
}

function normalizeExecutionInvocation(args = {}, operationName = 'relai_exec') {
  const command = typeof args.command === 'string' ? args.command.trim() : '';
  const executable = typeof args.executable === 'string' ? args.executable.trim() : '';
  if (Boolean(command) === Boolean(executable)) {
    throw new Error(`${operationName} requires exactly one execution mode: command or executable.`);
  }
  if (command.length > 20000) throw new Error(`${operationName} command must be 20000 characters or fewer.`);
  if (executable.length > 1000) throw new Error(`${operationName} executable must be 1000 characters or fewer.`);
  if (executable.includes('\0')) throw new Error(`${operationName} executable contains a null byte.`);
  if (command && (args.argv !== undefined || args.input !== undefined)) {
    throw new Error(`${operationName} argv and input are available only with executable direct mode.`);
  }
  const argv = executable ? normalizeDirectArgv(args.argv, operationName) : [];
  const input = executable ? normalizeDirectInput(args.input, operationName) : undefined;
  const displayCommand = command || directCommandSummary(executable, argv);
  let processExecutable = executable;
  let processArgv = argv;
  let executionLabel = 'Direct process';
  if (command) {
    const selectedShell = resolveShell();
    processExecutable = selectedShell.executable;
    processArgv = selectedShell.args(command);
    executionLabel = selectedShell.label;
  }
  return { command, executable, argv, input, displayCommand, processExecutable, processArgv, executionLabel };
}

function locateWindowsExecutable(name) {
  try {
    const result = childProcess.spawnSync(WHERE_EXE, [name], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) return '';
    return String(result.stdout || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
  } catch {
    return '';
  }
}

function powershellCommand(command) {
  return `$global:LASTEXITCODE = $null; & { ${command}\n}; if ($null -ne $global:LASTEXITCODE) { exit $global:LASTEXITCODE }; if (-not $?) { exit 1 }`;
}

function resolveShell() {
  if (cachedShell) return cachedShell;
  if (process.platform === 'win32') {
    const pwsh = locateWindowsExecutable('pwsh.exe');
    if (pwsh) {
      cachedShell = {
        executable: pwsh,
        label: 'PowerShell 7',
        args: command => ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershellCommand(command)]
      };
      return cachedShell;
    }
    const powershell = locateWindowsExecutable('powershell.exe');
    if (powershell) {
      cachedShell = {
        executable: powershell,
        label: 'Windows PowerShell',
        args: command => ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershellCommand(command)]
      };
      return cachedShell;
    }
    cachedShell = {
      executable: process.env.ComSpec || 'cmd.exe',
      label: 'Command Prompt',
      args: command => ['/d', '/s', '/c', command]
    };
    return cachedShell;
  }
  const preferred = String(process.env.SHELL || '').trim();
  const executable = preferred && fs.existsSync(preferred) ? preferred : '/bin/sh';
  cachedShell = { executable, label: path.basename(executable), args: command => ['-lc', command] };
  return cachedShell;
}

function redactCommandForAudit(value) {
  let text = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  text = text
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/(--(?:token|password|passwd|secret|api[-_]?key|auth[-_]?token|authtoken))(?:=|\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1 [REDACTED]')
    .replace(/\b((?:token|password|passwd|secret|api[-_]?key|auth[-_]?token|authtoken)[A-Za-z0-9_-]*)\s*=\s*("[^"]*"|'[^']*'|\S+)/gi, '$1=[REDACTED]')
    .replace(/(https?:\/\/[^\s:@/]+:)[^\s@/]+@/gi, '$1[REDACTED]@');
  const maxChars = 180;
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

async function readGitStatusMap(workspace, config) {
  // Keep the branch record first so runProcess's outer whitespace normalization can
  // never strip the leading status column from a tracked-worktree record such as " M".
  const result = await runProcess('git', gitStatusArgs(), {
    cwd: workspace.path,
    timeout: 30000,
    maxOutputBytes: INTERNAL_STATUS_MAX_BYTES
  }, config);
  if (result.exitCode !== 0 || result.stdoutTruncated) return null;
  return statusMutationSnapshot(workspace, result.stdout);
}

function statusMutationSnapshot(workspace, statusOutput) {
  const root = path.resolve(workspace.path);
  const statuses = statusMapFromOutput(statusOutput);
  return new Map([...statuses.entries()].map(([file, status]) => [
    file,
    `${status}\0${pathMetadataFingerprint(root, file)}`
  ]));
}

function pathMetadataFingerprint(root, relativePath) {
  const absolute = path.resolve(root, relativePath);
  if (!isPathInside(absolute, root)) return 'outside';
  try {
    const stat = fs.lstatSync(absolute, { bigint: true });
    return [stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs, stat.ino].join(':');
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    return `missing:${String(code || '')}`;
  }
}
function changedStatusFiles(before, after) {
  if (!before || !after) return { files: [], truncated: false };
  const all = new Set([...before.keys(), ...after.keys()]);
  const files = [...all]
    .filter(file => before.get(file) !== after.get(file))
    .sort((left, right) => left.localeCompare(right));
  return { files: files.slice(0, MAX_CHANGED_FILES), truncated: files.length > MAX_CHANGED_FILES };
}

async function relaiExec(workspace, config, args = {}, context = {}) {
  const {
    command,
    executable,
    input,
    displayCommand,
    processExecutable,
    processArgv,
    executionLabel
  } = normalizeExecutionInvocation(args, 'relai_exec');
  const cwd = resolveCommandCwd(workspace, args.cwd);
  const env = normalizeCommandEnv(args.env);
  const timeoutMs = clampNumber(args.timeoutMs, 1000, 86400000, 120000);
  const maxOutputBytes = clampNumber(args.maxOutputBytes, 1000, 16 * 1024 * 1024, config.maxOutputBytes || 2 * 1024 * 1024);
  const statusBefore = await readGitStatusMap(workspace, config);
  const signal = combineAbortSignals(
    getCurrentTaskAbortSignal(),
    args._operationTaskId ? nativeToolTaskSignal(args._operationTaskId) : undefined,
    context.signal
  );
  const result = await runSpan(config, 'relai.process.exec', {
    'relai.workspace': workspace.alias,
    'relai.process.command': redactCommandForAudit(displayCommand),
    'relai.process.execution_mode': command ? 'shell' : 'direct',
    'relai.operation_task.id': String(args._operationTaskId || '')
  }, () => runProcess(
    processExecutable,
    processArgv,
    {
      cwd: cwd.absolutePath,
      env,
      timeout: timeoutMs,
      maxOutputBytes,
      signal,
      ...(input !== undefined ? { input } : {})
    },
    config
  ));
  if (result.spawnError) {
    const host = command ? executionLabel : executable;
    throw new Error(`Could not start ${host}: ${result.error || 'unknown spawn error'}`);
  }
  const statusAfter = await readGitStatusMap(workspace, config);
  const changed = changedStatusFiles(statusBefore, statusAfter);
  return {
    ok: result.exitCode === 0,
    workspace: workspace.alias,
    command: displayCommand,
    commandSummary: redactCommandForAudit(displayCommand),
    cwd: cwd.relativePath,
    shell: executionLabel,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    stdoutBytes: result.stdoutBytes || 0,
    stderrBytes: result.stderrBytes || 0,
    stdoutTruncated: result.stdoutTruncated === true,
    stderrTruncated: result.stderrTruncated === true,
    timedOut: result.timedOut === true,
    cancelled: result.cancelled === true,
    ...(result.signal ? { signal: result.signal } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(Object.keys(env).length ? { environmentKeys: Object.keys(env).sort((left, right) => left.localeCompare(right)) } : {}),
    changedFiles: changed.files,
    changedFilesTruncated: changed.truncated,
    mutationTracking: statusBefore && statusAfter ? 'git' : 'unavailable'
  };
}

export {
  relaiExec,
  resolveCommandCwd,
  normalizeCommandEnv,
  normalizeDirectArgv,
  normalizeDirectInput,
  normalizeExecutionInvocation,
  resolveShell,
  redactCommandForAudit
};
