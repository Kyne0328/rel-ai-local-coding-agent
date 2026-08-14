import { spawn, spawnSync } from 'node:child_process';
import { resolveGitExecutable } from './gitExecutable.js';
import { makeProcessEnvironment } from './processEnvironment.js';
import { traceContextEnvironment } from './telemetry.js';

const TASKKILL_EXE = String.raw`C:\Windows\System32\taskkill.exe`;
const WINDOWS_POWERSHELL_EXE = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
const DEFAULT_TERMINATION_GRACE_MS = 1000;
const DEFAULT_FORCE_WAIT_MS = 2000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function processPid(target) {
  const value = typeof target === 'number' ? target : target?.pid;
  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : 0;
}

function isProcessAlive(target) {
  const pid = processPid(target);
  if (!pid) return false;
  if (typeof target === 'object' && target) {
    if (typeof target.exitCode === 'number' || target.signalCode) return false;
  }
  return isPidAlive(pid);
}

function isPidAlive(pidValue) {
  const pid = Number(pidValue);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function isProcessGroupAlive(pidValue) {
  const pid = Number(pidValue);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function isProcessTreeAlive(target) {
  const rootPid = processPid(target);
  if (!rootPid) return false;
  if (process.platform === 'win32') return windowsProcessTreePids(rootPid).some(isPidAlive);
  return isProcessGroupAlive(rootPid);
}

function signalProcessTree(target, options = {}) {
  const pid = processPid(target);
  if (!pid) return false;
  const force = options.force === true;
  const signal = force ? 'SIGKILL' : String(options.signal || 'SIGTERM');

  if (process.platform === 'win32') {
    try {
      const args = [...(force ? ['/f'] : []), '/t', '/pid', String(pid)];
      const result = spawnSync(TASKKILL_EXE, args, { stdio: 'ignore', windowsHide: true });
      if (result.status === 0) return true;
    } catch (error) {
      debugKill('[rel-ai-mcp] taskkill:', error);
    }
  } else {
    try {
      process.kill(-pid, signal);
      return true;
    } catch (error) {
      debugKill('[rel-ai-mcp] kill process group:', error);
    }
  }

  try {
    if (typeof target?.kill === 'function') target.kill(signal);
    else process.kill(pid, signal);
    return true;
  } catch (error) {
    debugKill(`[rel-ai-mcp] kill ${signal}:`, error);
    return !isProcessAlive(target);
  }
}

function killProcessTree(target) {
  return signalProcessTree(target, { force: true, signal: 'SIGKILL' });
}

async function terminateProcessTree(target, options = {}) {
  const graceMs = clampMilliseconds(options.graceMs, 0, 30000, DEFAULT_TERMINATION_GRACE_MS);
  const forceWaitMs = clampMilliseconds(options.forceWaitMs, 0, 30000, DEFAULT_FORCE_WAIT_MS);
  const rootPid = processPid(target);
  const trackedPids = process.platform === 'win32' ? windowsProcessTreePids(rootPid) : [];
  const treeAlive = process.platform === 'win32'
    ? trackedPids.some(isPidAlive)
    : isProcessGroupAlive(rootPid);
  if (!treeAlive) {
    return { exited: true, forced: false, gracefulSignalSent: false, forceSignalSent: false };
  }

  const gracefulSignalSent = signalProcessTree(target, { signal: options.signal || 'SIGTERM' });
  const gracefulExit = process.platform === 'win32'
    ? await waitForPidSetExit(trackedPids, graceMs)
    : await waitForProcessGroupExit(rootPid, graceMs);
  if (gracefulExit) {
    return { exited: true, forced: false, gracefulSignalSent, forceSignalSent: false };
  }

  const forceSignalSent = process.platform === 'win32'
    ? forceWindowsProcessTree(trackedPids)
    : signalProcessTree(target, { force: true, signal: 'SIGKILL' });
  const exited = process.platform === 'win32'
    ? await waitForPidSetExit(trackedPids, forceWaitMs)
    : await waitForProcessGroupExit(rootPid, forceWaitMs);
  return { exited, forced: true, gracefulSignalSent, forceSignalSent };
}

function windowsProcessTreePids(rootPid) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) return [];
  const script = [
    `$rootPid = ${rootPid}`,
    '$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId',
    '$ids = @([int]$rootPid)',
    'for ($i = 0; $i -lt $ids.Count; $i++) {',
    '  $parent = $ids[$i]',
    '  $ids += @($all | Where-Object { $_.ParentProcessId -eq $parent } | ForEach-Object { [int]$_.ProcessId })',
    '}',
    '[Console]::Out.Write(($ids | Select-Object -Unique) -join ",")'
  ].join('; ');
  try {
    const result = spawnSync(WINDOWS_POWERSHELL_EXE, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script
    ], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });
    const pids = String(result.stdout || '')
      .split(',')
      .map(value => Number(value.trim()))
      .filter(value => Number.isSafeInteger(value) && value > 0);
    return pids.length ? [...new Set(pids)] : [rootPid];
  } catch (error) {
    debugKill('[rel-ai-mcp] enumerate Windows process tree:', error);
    return [rootPid];
  }
}

function forceWindowsProcessTree(pids) {
  let signalSent = false;
  for (const pid of [...new Set(pids)].reverse()) {
    if (!isPidAlive(pid)) continue;
    try {
      const result = spawnSync(TASKKILL_EXE, ['/f', '/t', '/pid', String(pid)], {
        stdio: 'ignore',
        windowsHide: true
      });
      signalSent = result.status === 0 || signalSent;
    } catch (error) {
      debugKill('[rel-ai-mcp] force Windows process tree:', error);
    }
  }
  return signalSent;
}

function waitForPidSetExit(pids, timeoutMs) {
  const uniquePids = [...new Set(pids)];
  const exited = () => uniquePids.every(pid => !isPidAlive(pid));
  if (exited()) return Promise.resolve(true);
  if (timeoutMs <= 0) return Promise.resolve(exited());
  return new Promise(resolve => {
    const interval = setInterval(() => {
      if (exited()) finish(true);
    }, 25);
    const timer = setTimeout(() => finish(exited()), timeoutMs);
    function finish(value) {
      clearInterval(interval);
      clearTimeout(timer);
      resolve(value);
    }
  });
}

function waitForProcessGroupExit(pid, timeoutMs) {
  if (!isProcessGroupAlive(pid)) return Promise.resolve(true);
  if (timeoutMs <= 0) return Promise.resolve(!isProcessGroupAlive(pid));
  return new Promise(resolve => {
    let settled = false;
    const interval = setInterval(() => {
      if (!isProcessGroupAlive(pid)) finish(true);
    }, 25);
    const timer = setTimeout(() => finish(!isProcessGroupAlive(pid)), timeoutMs);
    function finish(exited) {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      clearTimeout(timer);
      resolve(exited);
    }
  });
}


function runProcess(command, args, options = {}, config = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let timer = null;
    let terminationRequest = null;
    const configuredMaxOutputBytes = Number(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
    const maxOutputBytes = Number.isFinite(configuredMaxOutputBytes) && configuredMaxOutputBytes > 0
      ? configuredMaxOutputBytes
      : DEFAULT_MAX_OUTPUT_BYTES;
    const timeoutMs = Number.isFinite(Number(options.timeout)) && Number(options.timeout) > 0
      ? Number(options.timeout)
      : 0;
    const terminationGraceMs = clampMilliseconds(
      options.terminationGraceMs ?? config.processTerminationGraceMs,
      0,
      30000,
      DEFAULT_TERMINATION_GRACE_MS
    );
    const forceWaitMs = clampMilliseconds(
      options.forceWaitMs ?? config.processForceWaitMs,
      0,
      30000,
      DEFAULT_FORCE_WAIT_MS
    );
    const executable = command === 'git' ? (resolveGitExecutable() || command) : command;
    const childEnvironment = makeProcessEnvironment(options.env, { allow: config.processEnvironment?.allow });
    Object.assign(childEnvironment, traceContextEnvironment());
    const spawnOptions = {
      cwd: options.cwd,
      env: childEnvironment,
      detached: process.platform !== 'win32',
      windowsHide: true
    };
    const child = options.shell
      ? spawn(options.commandString || executable, { ...spawnOptions, shell: true })
      : spawn(executable, args || [], { ...spawnOptions, shell: false });
    const abortSignal = options.signal;

    function finish(payload) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      abortSignal?.removeEventListener?.('abort', onAbort);
      resolve({
        ...payload,
        durationMs: Date.now() - startedAt,
        stdoutBytes,
        stderrBytes,
        stdoutTruncated,
        stderrTruncated
      });
    }

    function finishTermination(code, signal, outcome = {}) {
      const request = terminationRequest;
      if (!request || settled) return;
      finish({
        exitCode: typeof code === 'number' ? code : -1,
        signal: signal || (outcome.forced ? 'SIGKILL' : 'SIGTERM'),
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: request.error,
        cancelled: request.cancelled === true,
        timedOut: request.timedOut === true,
        terminationConfirmed: outcome.exited !== false,
        forcedTermination: outcome.forced === true
      });
    }

    function requestTermination(request) {
      if (settled || terminationRequest) return;
      terminationRequest = request;
      stderrTruncated = stderrTruncated || Buffer.byteLength(stderr + request.marker, 'utf8') > maxOutputBytes;
      stderr = appendLimited(stderr, request.marker, maxOutputBytes);
      void terminateProcessTree(child, { graceMs: terminationGraceMs, forceWaitMs })
        .then(outcome => finishTermination(child.exitCode, child.signalCode, outcome))
        .catch(error => finishTermination(-1, undefined, {
          exited: !isProcessTreeAlive(child),
          forced: true,
          error: error instanceof Error ? error.message : String(error)
        }));
    }

    function onAbort() {
      requestTermination({
        marker: '\n[rel-ai-mcp operation cancelled]\n',
        error: 'Operation cancelled.',
        cancelled: true,
        timedOut: false
      });
    }

    if (child.stdin) {
      if (options.input != null) child.stdin.end(String(options.input));
      else child.stdin.end();
    }

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdoutBytes += Buffer.byteLength(chunk);
      stdoutTruncated = stdoutTruncated || stdoutBytes > maxOutputBytes;
      stdout = appendLimited(stdout, text, maxOutputBytes);
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrBytes += Buffer.byteLength(chunk);
      stderrTruncated = stderrTruncated || stderrBytes > maxOutputBytes;
      stderr = appendLimited(stderr, text, maxOutputBytes);
    });
    child.on('error', (error) => {
      if (settled) return;
      if (terminationRequest) return;
      finish({
        exitCode: -1,
        signal: undefined,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: error.message,
        spawnError: true,
        timedOut: false
      });
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      if (terminationRequest) return;
      finish({
        exitCode: typeof code === 'number' ? code : -1,
        signal: signal || undefined,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut: false
      });
    });

    if (abortSignal?.aborted) onAbort();
    else abortSignal?.addEventListener?.('abort', onAbort, { once: true });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        requestTermination({
          marker: `\n[rel-ai-mcp timed out after ${timeoutMs}ms]\n`,
          error: `Timed out after ${timeoutMs}ms`,
          cancelled: false,
          timedOut: true
        });
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }
  });
}

function appendLimited(current, next, maxBytes) {
  const combined = current + next;
  if (Buffer.byteLength(combined, 'utf8') <= maxBytes) return combined;
  const marker = '\n[rel-ai-mcp truncated output]\n';
  const allowed = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
  const buffer = Buffer.from(combined, 'utf8');
  const tail = buffer.subarray(Math.max(0, buffer.length - allowed)).toString('utf8').replace(/^\uFFFD+/u, '');
  return marker + tail;
}

function summarizeCommand(result) {
  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    ...(result.signal ? { signal: result.signal } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(result.durationMs != null ? { durationMs: result.durationMs } : {}),
    ...(result.stdoutBytes != null ? { stdoutBytes: result.stdoutBytes } : {}),
    ...(result.stderrBytes != null ? { stderrBytes: result.stderrBytes } : {}),
    ...(result.stdoutTruncated ? { stdoutTruncated: true } : {}),
    ...(result.stderrTruncated ? { stderrTruncated: true } : {}),
    ...(result.timedOut ? { timedOut: true } : {}),
    ...(result.cancelled ? { cancelled: true } : {}),
    ...(result.terminationConfirmed != null ? { terminationConfirmed: result.terminationConfirmed } : {}),
    ...(result.forcedTermination ? { forcedTermination: true } : {}),
    ...(result.stdout ? { stdout: result.stdout } : {}),
    ...(result.stderr ? { stderr: result.stderr } : {})
  };
}

function clampMilliseconds(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function debugKill(label, error) {
  if (process.env.REL_AI_MCP_DEBUG) console.error(label, error);
}

export {
  appendLimited,

  isProcessTreeAlive,
  killProcessTree,
  runProcess,

  summarizeCommand,
  terminateProcessTree,

};
