// @ts-check


import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import { runProcess } from "../process.js";
import { operationTaskSignal } from "../operationTasks.js";
import { runSpan } from "../telemetry.js";
import { isPathInside } from "../safety.js";
import { INTERNAL_STATUS_MAX_BYTES, gitStatusArgs, statusMapFromOutput } from "../repo/gitStatus.js";

const WHERE_EXE = String.raw`C:\Windows\System32\where.exe`;
const MAX_CHANGED_FILES = 200;
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
  return statusMapFromOutput(result.stdout);
}

function changedStatusFiles(before, after) {
  if (!before || !after) return { files: [], truncated: false };
  const all = new Set([...before.keys(), ...after.keys()]);
  const files = [...all]
    .filter(file => before.get(file) !== after.get(file))
    .sort((left, right) => left.localeCompare(right));
  return { files: files.slice(0, MAX_CHANGED_FILES), truncated: files.length > MAX_CHANGED_FILES };
}

async function relaiExec(workspace, config, args = {}) {
  const command = String(args.command || '').trim();
  if (!command) throw new Error('relai_exec requires a non-empty command.');
  if (command.length > 20000) throw new Error('relai_exec command must be 20000 characters or fewer.');
  const cwd = resolveCommandCwd(workspace, args.cwd);
  const env = normalizeCommandEnv(args.env);
  const timeoutMs = clampNumber(args.timeoutMs, 1000, 86400000, 120000);
  const maxOutputBytes = clampNumber(args.maxOutputBytes, 1000, 16 * 1024 * 1024, config.maxOutputBytes || 2 * 1024 * 1024);
  const shell = resolveShell();
  const statusBefore = await readGitStatusMap(workspace, config);
  const signal = args._operationTaskId ? operationTaskSignal(config, args._operationTaskId) : undefined;
  const result = await runSpan(config, 'relai.process.exec', {
    'relai.workspace': workspace.alias,
    'relai.process.command': redactCommandForAudit(command),
    'relai.operation_task.id': String(args._operationTaskId || '')
  }, () => runProcess(shell.executable, shell.args(command), {
    cwd: cwd.absolutePath,
    env,
    timeout: timeoutMs,
    maxOutputBytes,
    signal
  }, config));
  if (result.spawnError) throw new Error(`Could not start ${shell.label}: ${result.error || 'unknown spawn error'}`);
  const statusAfter = await readGitStatusMap(workspace, config);
  const changed = changedStatusFiles(statusBefore, statusAfter);
  return {
    ok: result.exitCode === 0,
    workspace: workspace.alias,
    command,
    commandSummary: redactCommandForAudit(command),
    cwd: cwd.relativePath,
    shell: shell.label,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    stdoutBytes: result.stdoutBytes || 0,
    stderrBytes: result.stderrBytes || 0,
    stdoutTruncated: result.stdoutTruncated === true,
    stderrTruncated: result.stderrTruncated === true,
    timedOut: result.timedOut === true,
    ...(result.signal ? { signal: result.signal } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(Object.keys(env).length ? { environmentKeys: Object.keys(env).sort((left, right) => left.localeCompare(right)) } : {}),
    changedFiles: changed.files,
    changedFilesTruncated: changed.truncated,
    mutationTracking: statusBefore && statusAfter ? 'git' : 'unavailable'
  };
}

export { relaiExec, resolveCommandCwd, normalizeCommandEnv, resolveShell, powershellCommand, redactCommandForAudit, statusMapFromOutput, changedStatusFiles };
