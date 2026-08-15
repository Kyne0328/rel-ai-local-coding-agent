// @ts-check

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';
import { runProcess } from '../process.js';
import { nativeToolTaskSignal } from '../mcp/nativeToolTasks.js';
import { getCurrentTaskAbortSignal } from '../toolActivity.js';
import { combineAbortSignals } from '../abortSignals.js';
import { runSpan } from '../telemetry.js';
import { isReusableDependencyPath } from '../reusableDependencies.js';
import { isPathInside } from '../safety.js';
import { INTERNAL_STATUS_MAX_BYTES, gitStatusArgs, statusMapFromOutput } from '../repo/gitStatus.js';
import { clampNumber } from './limits.js';
const WHERE_EXE = String.raw`C:\Windows\System32\where.exe`;
const MAX_CHANGED_FILES = 200;
const MAX_DIRECT_ARGV_ITEMS = 100;
const MAX_DIRECT_ARG_LENGTH = 20000;
const MAX_DIRECT_INPUT_LENGTH = 1024 * 1024;
/** @typedef {{ executable: string, label: string, args: (command: string) => string[] }} CommandHost */
/** @type {CommandHost | null} */
let cachedShell = null;

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
  const execution = command ? resolveShellProcess(command) : resolveDirectProcess(executable, argv);
  return {
    command,
    executable,
    argv,
    input,
    displayCommand,
    processExecutable: execution.executable,
    processArgv: execution.argv,
    executionLabel: execution.label
  };
}

function resolveShellProcess(command) {
  const shell = resolveShell();
  return { executable: shell.executable, argv: shell.args(command), label: shell.label };
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

function resolveDirectProcess(executable, argv) {
  if (process.platform !== 'win32') return { executable, argv, label: 'Direct process' };
  const base = path.basename(String(executable || '')).toLowerCase().replace(/\.(?:cmd|exe)$/i, '');
  if (base !== 'npm' && base !== 'npx') return { executable, argv, label: 'Direct process' };
  const cli = resolveNpmCli(base);
  if (!cli) return { executable, argv, label: 'Direct process' };
  return {
    executable: process.execPath,
    argv: [cli, ...argv],
    label: `Direct ${base} CLI`
  };
}

function resolveNpmCli(command) {
  const file = command === 'npx' ? 'npx-cli.js' : 'npm-cli.js';
  const candidates = [
    command === 'npm' ? process.env.npm_execpath : '',
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', file)
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || '';
}

function processExecutionError(code, message, retryable = false) {
  const error = /** @type {Error & { code: string, source: string, operation: string, retryable: boolean }} */ (new Error(message));
  error.code = code;
  error.source = 'rel-ai-mcp-process';
  error.operation = 'execute';
  error.retryable = retryable;
  return error;
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
  return boundedChangedFiles(files);
}

async function changedFilesSinceCommit(workspace, config, commit) {
  const baseline = String(commit || '').trim();
  if (!/^[0-9a-f]{40,64}$/i.test(baseline)) return null;
  const tracked = await runProcess('git', ['diff', '--name-status', '-z', '--no-renames', baseline, '--'], {
    cwd: workspace.path,
    timeout: 30000,
    maxOutputBytes: INTERNAL_STATUS_MAX_BYTES
  }, config);
  if (tracked.exitCode !== 0 || tracked.stdoutTruncated) return null;
  const untracked = await runProcess('git', ['ls-files', '-t', '-z', '--others', '--exclude-standard'], {
    cwd: workspace.path,
    timeout: 30000,
    maxOutputBytes: INTERNAL_STATUS_MAX_BYTES
  }, config);
  if (untracked.exitCode !== 0 || untracked.stdoutTruncated) return null;
  return boundedChangedFiles([
    ...parseNameStatusPaths(tracked.stdout),
    ...parseTaggedUntrackedPaths(untracked.stdout)
  ]);
}

function parseNameStatusPaths(output) {
  const records = String(output || '').split('\0').filter(Boolean);
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab >= 0) {
      const candidate = record.slice(tab + 1);
      if (candidate) paths.push(candidate);
      continue;
    }
    const next = records[index + 1];
    if (/^[A-Z][0-9]*$/i.test(record) && next) {
      paths.push(next);
      index += 1;
    }
  }
  return paths;
}

function parseTaggedUntrackedPaths(output) {
  return String(output || '').split('\0').filter(Boolean).map(record =>
    record.startsWith('? ') ? record.slice(2) : record
  ).filter(Boolean);
}

function boundedChangedFiles(files) {
  const uniqueFiles = [...new Set(files.map(file => String(file || '').replaceAll('\\', '/')).filter(Boolean))]
    .filter(file => !isReusableDependencyPath(file))
    .sort((left, right) => left.localeCompare(right));
  return { files: uniqueFiles.slice(0, MAX_CHANGED_FILES), truncated: uniqueFiles.length > MAX_CHANGED_FILES };
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
  const maxOutputBytes = clampNumber(args.maxOutputBytes, 1000, 16 * 1024 * 1024, 2 * 1024 * 1024);
  const sandboxBaseline = workspace.taskSandbox === true ? String(context.mutationBaselineCommit || '').trim() : '';
  const statusBefore = sandboxBaseline ? null : await readGitStatusMap(workspace, config);
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
    throw processExecutionError('PROCESS_SPAWN_FAILED', `Could not start ${host}: ${result.error || 'unknown spawn error'}`);
  }
  let mutationTracking = 'unavailable';
  let changed;
  if (sandboxBaseline) {
    changed = await changedFilesSinceCommit(workspace, config, sandboxBaseline);
    if (changed) mutationTracking = 'sandbox-baseline';
    else {
      const statusAfter = await readGitStatusMap(workspace, config);
      changed = statusAfter ? boundedChangedFiles([...statusAfter.keys()]) : { files: [], truncated: false };
      if (statusAfter) mutationTracking = 'sandbox-status-fallback';
    }
  } else {
    const statusAfter = await readGitStatusMap(workspace, config);
    changed = changedStatusFiles(statusBefore, statusAfter);
    if (statusBefore && statusAfter) mutationTracking = 'git';
  }
  const commandSucceeded = result.exitCode === 0 && result.timedOut !== true && result.cancelled !== true;
  return {
    ok: true,
    executed: true,
    commandSucceeded,
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
    mutationTracking
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
