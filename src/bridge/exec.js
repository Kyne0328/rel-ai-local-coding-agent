// @ts-check

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';
import { runProcess } from '../process.js';
import { nativeToolTaskSignal } from '../mcp/nativeToolTasks.js';
import { getCurrentTaskAbortSignal } from '../toolActivity.js';
import { combineAbortSignals } from '../abortSignals.js';
import { outputSpillOwner } from '../outputSpill.js';
import { runSpan } from '../telemetry.js';
import { isReusableDependencyPath } from '../reusableDependencies.js';
import { createCollectionPathFilter, isPathInside } from '../safety.js';
import { INTERNAL_STATUS_MAX_BYTES, gitStatusArgs, statusMapFromOutput } from '../repo/gitStatus.js';
import { directCommandDisplay, redactCommandForAudit } from '../commandDisplay.js';
import { clampNumber } from './limits.js';
const WHERE_EXE = String.raw`C:\Windows\System32\where.exe`;
const MAX_CHANGED_FILES = 200;
const MAX_FILESYSTEM_MUTATION_FILES = 50_000;
const MAX_DIRECT_ARGV_ITEMS = 100;
const MAX_DIRECT_ARG_LENGTH = 20000;
const MAX_DIRECT_INPUT_LENGTH = 1024 * 1024;
/** @typedef {{ executable: string, label: string, args: (command: string) => string[] }} CommandHost */
/** @type {CommandHost | null} */
let cachedShell = null;

function resolveCommandCwd(workspace, value) {
  const raw = String(value == null || value === '' ? '.' : value).trim() || '.';
  if (path.isAbsolute(raw)) throw new Error('relai_exec cwd must be relative to the configured workspace.');
  const root = path.resolve(workspace.path);
  const candidate = path.resolve(root, raw);
  if (!isPathInside(candidate, root)) throw new Error(`relai_exec cwd escapes the workspace: ${raw}`);
  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`relai_exec cwd does not exist: ${raw}`, { cause: error });
    }
    throw error;
  }
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
  const displayCommand = command || directCommandDisplay(executable, argv);
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
  if (process.platform === 'win32' && shell.label === 'Windows PowerShell' && /&&|\|\|/.test(command)) {
    const executable = process.env.ComSpec || 'cmd.exe';
    return { executable, argv: ['/d', '/s', '/c', command], label: 'Command Prompt' };
  }
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
  return `$global:LASTEXITCODE = $null; $ErrorActionPreference = 'Stop'; try { & { ${command}\n} } catch { [Console]::Error.WriteLine($_); exit 1 }; if ($null -ne $global:LASTEXITCODE) { exit $global:LASTEXITCODE }`;
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

async function readGitStatusMap(workspace, config) {
  // Mutation tracking only needs status records, not branch/ahead metadata. Preserve
  // Git's leading status column explicitly so branch output is no longer needed as a
  // whitespace sentinel for records such as " M file.js".
  const result = await runProcess('git', gitStatusArgs({ branch: false }), {
    cwd: workspace.path,
    timeout: 30000,
    maxOutputBytes: INTERNAL_STATUS_MAX_BYTES,
    preserveOutputWhitespace: true
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

function readFilesystemStatusMap(workspace) {
  const root = path.resolve(workspace.path);
  // Mutation accounting is an integrity boundary, not a read-context boundary.
  // Cover the whole workspace even when normal repository context is narrowed.
  const shouldCollect = createCollectionPathFilter(root);
  const snapshot = new Map();
  const pending = [{ absolutePath: root, relativePath: '' }];
  let complete = true;
  let fileCount = 0;

  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    let entries;
    try {
      entries = fs.readdirSync(current.absolutePath, { withFileTypes: true });
    } catch {
      complete = false;
      continue;
    }
    for (const entry of entries) {
      const relativePath = current.relativePath
        ? `${current.relativePath}/${entry.name}`
        : entry.name;
      if (!shouldCollect(relativePath)) continue;
      if (entry.isSymbolicLink()) {
        complete = false;
        continue;
      }
      const absolutePath = path.join(current.absolutePath, entry.name);
      if (entry.isDirectory()) {
        pending.push({ absolutePath, relativePath });
        continue;
      }
      if (!entry.isFile()) continue;
      fileCount += 1;
      if (fileCount > MAX_FILESYSTEM_MUTATION_FILES) {
        return { snapshot, complete: false };
      }
      snapshot.set(relativePath, pathMetadataFingerprint(root, relativePath));
    }
  }
  return { snapshot, complete };
}

function changedStatusFiles(before, after) {
  if (!before || !after) return { files: [], truncated: false };
  const all = new Set([...before.keys(), ...after.keys()]);
  const files = [...all]
    .filter(file => before.get(file) !== after.get(file))
    .sort((left, right) => left.localeCompare(right));
  return boundedChangedFiles(files);
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
  const trackMutation = context.mutationTrackingRequired !== false;
  const statusBefore = trackMutation ? await readGitStatusMap(workspace, config) : null;
  const filesystemBefore = trackMutation && !statusBefore ? readFilesystemStatusMap(workspace) : null;
  const signal = combineAbortSignals(
    getCurrentTaskAbortSignal(),
    args._operationTaskId ? nativeToolTaskSignal(args._operationTaskId) : undefined,
    context.signal
  );
  const commandSummary = redactCommandForAudit(displayCommand);
  const result = await runSpan(config, 'relai.process.exec', {
    'relai.workspace': workspace.alias,
    'relai.process.command': commandSummary,
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
      outputSpillTaskId: outputSpillOwner({
        taskId: context.taskId || args.work_id,
        workspace: workspace.alias,
        principal: context.principal
      }),
      ...(input !== undefined ? { input } : {})
    },
    config
  ));
  if (result.spawnError) {
    const host = command ? executionLabel : executable;
    throw processExecutionError('PROCESS_SPAWN_FAILED', `Could not start ${host}: ${result.error || 'unknown spawn error'}`);
  }
  let mutationTracking = 'unavailable';
  let mutationUnknown = false;
  let changed;
  if (!trackMutation) {
    changed = { files: [], truncated: false };
    mutationTracking = 'declared-read-only';
  } else {
    const statusAfter = await readGitStatusMap(workspace, config);
    if (statusBefore && statusAfter) {
      changed = changedStatusFiles(statusBefore, statusAfter);
      mutationTracking = 'git';
    } else if (!statusBefore && filesystemBefore) {
      const filesystemAfter = readFilesystemStatusMap(workspace);
      changed = changedStatusFiles(filesystemBefore.snapshot, filesystemAfter.snapshot);
      mutationTracking = 'filesystem';
      mutationUnknown = filesystemBefore.complete !== true || filesystemAfter.complete !== true;
    } else {
      changed = { files: [], truncated: false };
      mutationUnknown = true;
    }
  }
  const commandSucceeded = result.exitCode === 0 && result.timedOut !== true && result.cancelled !== true;
  return {
    ok: true,
    executed: true,
    commandSucceeded,
    workspace: workspace.alias,
    command: commandSummary,
    commandSummary,
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
    ...(result.stdoutOutputRef ? { stdoutOutputRef: result.stdoutOutputRef, stdoutSpillTruncated: result.stdoutSpillTruncated === true } : {}),
    ...(result.stderrOutputRef ? { stderrOutputRef: result.stderrOutputRef, stderrSpillTruncated: result.stderrSpillTruncated === true } : {}),
    timedOut: result.timedOut === true,
    cancelled: result.cancelled === true,
    ...(result.signal ? { signal: result.signal } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(Object.keys(env).length ? { environmentKeys: Object.keys(env).sort((left, right) => left.localeCompare(right)) } : {}),
    changedFiles: changed.files,
    changedFilesTruncated: changed.truncated,
    mutationTracking,
    ...(mutationUnknown ? { mutationUnknown: true } : {})
  };
}

export {
  relaiExec,
  resolveCommandCwd,
  normalizeCommandEnv,
  normalizeExecutionInvocation,
  redactCommandForAudit
};
