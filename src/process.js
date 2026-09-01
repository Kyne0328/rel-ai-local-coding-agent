import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveGitExecutable } from './gitExecutable.js';
import { makeProcessEnvironment } from './processEnvironment.js';
import { getStateDir } from './statePaths.js';
import { traceContextEnvironment } from './telemetry.js';
import { createOutputSpillWriter } from './outputSpill.js';

const TASKKILL_EXE = String.raw`C:\Windows\System32\taskkill.exe`;
const DEFAULT_TERMINATION_GRACE_MS = 1000;
const DEFAULT_FORCE_WAIT_MS = 2000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DISABLED_GIT_HOOKS_PATH = `.disabled-git-hooks-${process.pid}-${crypto.randomBytes(12).toString('hex')}`;

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
  if (process.platform === 'win32') return isProcessAlive(target);
  return isProcessGroupAlive(rootPid);
}

function signalProcessTree(target, options = {}) {
  const pid = processPid(target);
  if (!pid) return false;
  const force = options.force === true;
  const signal = force ? 'SIGKILL' : String(options.signal || 'SIGTERM');

  if (process.platform === 'win32') {
    if (!isProcessAlive(target)) return false;
    try {
      const args = [...(force ? ['/f'] : []), '/t', '/pid', String(pid)];
      const killer = spawn(TASKKILL_EXE, args, { stdio: 'ignore', windowsHide: true });
      killer.once('error', error => debugKill('[rel-ai-mcp] taskkill:', error));
      killer.unref?.();
      return true;
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
  const trackedTargets = process.platform === 'win32' ? [target] : [];
  const treeAlive = process.platform === 'win32'
    ? isProcessAlive(target)
    : isProcessGroupAlive(rootPid);
  if (!treeAlive) {
    return { exited: true, forced: false, gracefulSignalSent: false, forceSignalSent: false };
  }

  const gracefulSignalSent = process.platform === 'win32'
    ? await signalWindowsProcessTree(target)
    : signalProcessTree(target, { signal: options.signal || 'SIGTERM' });
  const gracefulExit = process.platform === 'win32'
    ? await waitForWindowsTargetsExit(trackedTargets, graceMs)
    : await waitForProcessGroupExit(rootPid, graceMs);
  if (gracefulExit) {
    return { exited: true, forced: false, gracefulSignalSent, forceSignalSent: false };
  }

  const forceSignalSent = process.platform === 'win32'
    ? await forceWindowsProcessTree(trackedTargets)
    : signalProcessTree(target, { force: true, signal: 'SIGKILL' });
  const exited = process.platform === 'win32'
    ? await waitForWindowsTargetsExit(trackedTargets, forceWaitMs)
    : await waitForProcessGroupExit(rootPid, forceWaitMs);
  return { exited, forced: true, gracefulSignalSent, forceSignalSent };
}

async function signalWindowsProcessTree(target, force = false) {
  const pid = processPid(target);
  if (!pid || !isProcessAlive(target)) return false;
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const killer = spawn(TASKKILL_EXE, [...(force ? ['/f'] : []), '/t', '/pid', String(pid)], {
        stdio: 'ignore',
        windowsHide: true
      });
      killer.once('error', error => {
        debugKill(`[rel-ai-mcp] ${force ? 'force ' : ''}Windows process tree:`, error);
        finish(!isProcessAlive(target));
      });
      killer.once('close', code => finish(code === 0 || !isProcessAlive(target)));
    } catch (error) {
      debugKill(`[rel-ai-mcp] ${force ? 'force ' : ''}Windows process tree:`, error);
      finish(!isProcessAlive(target));
    }
  });
}

async function forceWindowsProcessTree(targets) {
  let signalSent = false;
  const uniqueTargets = [...new Map(targets.map(target => [processPid(target), target])).values()];
  for (const target of uniqueTargets.reverse()) {
    if (!isProcessAlive(target)) continue;
    signalSent = await signalWindowsProcessTree(target, true) || signalSent;
  }
  return signalSent;
}

function waitForWindowsTargetsExit(targets, timeoutMs) {
  const uniqueTargets = [...new Map(targets.map(target => [processPid(target), target])).values()];
  const exited = () => uniqueTargets.every(target => !isProcessAlive(target));
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
    const stdoutSpill = createOutputSpillWriter(config, options.outputSpillTaskId);
    const stderrSpill = createOutputSpillWriter(config, options.outputSpillTaskId);
    const stdoutBuffer = new BoundedOutputBuffer(maxOutputBytes, stdoutSpill);
    const stderrBuffer = new BoundedOutputBuffer(maxOutputBytes, stderrSpill);
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
    const isGit = command === 'git';
    if (isGit && options.shell) throw new Error('Rel.AI-owned Git commands must run without shell parsing.');
    const executable = isGit ? (resolveGitExecutable() || command) : command;
    const childEnvironment = makeProcessEnvironment(options.env, {
      allow: config.processEnvironment?.allow,
      inheritCredentials: options.inheritCredentials === true
    });
    Object.assign(childEnvironment, traceContextEnvironment());
    const processArgs = isGit ? hardenedGitArgs(config, args || []) : (args || []);
    const spawnOptions = {
      cwd: options.cwd,
      env: childEnvironment,
      detached: process.platform !== 'win32',
      windowsHide: true
    };
    const child = options.shell
      ? spawn(options.commandString || executable, { ...spawnOptions, shell: true })
      : spawn(executable, processArgs, { ...spawnOptions, shell: false });
    const abortSignal = options.signal;
    let resolveChildClosed;
    const childClosed = new Promise(resolve => { resolveChildClosed = resolve; });

    function finish(payload) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      abortSignal?.removeEventListener?.('abort', onAbort);
      const stdoutSpillResult = stdoutSpill.finish();
      const stderrSpillResult = stderrSpill.finish();
      resolve({
        ...payload,
        durationMs: Date.now() - startedAt,
        stdoutBytes,
        stderrBytes,
        stdoutTruncated,
        stderrTruncated,
        ...(stdoutSpillResult ? { stdoutOutputRef: stdoutSpillResult.outputRef, stdoutSpillTruncated: stdoutSpillResult.spillTruncated } : {}),
        ...(stderrSpillResult ? { stderrOutputRef: stderrSpillResult.outputRef, stderrSpillTruncated: stderrSpillResult.spillTruncated } : {})
      });
    }

    function finishTermination(code, signal, outcome = {}) {
      const request = terminationRequest;
      if (!request || settled) return;
      finish({
        exitCode: typeof code === 'number' ? code : -1,
        signal: signal || (outcome.forced ? 'SIGKILL' : 'SIGTERM'),
        stdout: processOutputText(stdoutBuffer, options.preserveOutputWhitespace),
        stderr: processOutputText(stderrBuffer, options.preserveOutputWhitespace),
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
      stderrBuffer.append(request.marker);
      stderrTruncated = stderrBuffer.truncated;
      void terminateProcessTree(child, { graceMs: terminationGraceMs, forceWaitMs })
        .then(async outcome => {
          await childClosed;
          finishTermination(child.exitCode, child.signalCode, outcome);
        })
        .catch(async error => {
          await childClosed;
          finishTermination(-1, undefined, {
            exited: !isProcessTreeAlive(child),
            forced: true,
            error: error instanceof Error ? error.message : String(error)
          });
        });
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
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buffer.length;
      stdoutBuffer.append(buffer);
      stdoutTruncated = stdoutBuffer.truncated;
    });
    child.stderr?.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += buffer.length;
      stderrBuffer.append(buffer);
      stderrTruncated = stderrBuffer.truncated;
    });
    child.on('error', (error) => {
      resolveChildClosed();
      if (settled) return;
      if (terminationRequest) return;
      finish({
        exitCode: -1,
        signal: undefined,
        stdout: processOutputText(stdoutBuffer, options.preserveOutputWhitespace),
        stderr: processOutputText(stderrBuffer, options.preserveOutputWhitespace),
        error: error.message,
        spawnError: true,
        timedOut: false
      });
    });
    child.on('close', (code, signal) => {
      resolveChildClosed();
      if (settled) return;
      if (terminationRequest) return;
      finish({
        exitCode: typeof code === 'number' ? code : -1,
        signal: signal || undefined,
        stdout: processOutputText(stdoutBuffer, options.preserveOutputWhitespace),
        stderr: processOutputText(stderrBuffer, options.preserveOutputWhitespace),
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

function hardenedGitArgs(config, args) {
  const hooksPath = path.join(getStateDir(config), DISABLED_GIT_HOOKS_PATH);
  return [
    '-c', `core.hooksPath=${hooksPath}`,
    '-c', 'core.fsmonitor=false',
    '-c', 'commit.gpgSign=false',
    '-c', 'tag.gpgSign=false',
    '-c', 'push.gpgSign=false',
    ...args
  ];
}

function processOutputText(buffer, preserveWhitespace = false) {
  const text = buffer.text();
  return preserveWhitespace ? text : text.trim();
}

const TRUNCATED_OUTPUT_MARKER = '\n[rel-ai-mcp truncated output]\n';
const TRUNCATED_OUTPUT_MARKER_BYTES = Buffer.byteLength(TRUNCATED_OUTPUT_MARKER, 'utf8');

class BoundedOutputBuffer {
  constructor(maxBytes, spill = null) {
    this.maxBytes = Math.max(0, Number(maxBytes) || 0);
    this.chunks = [];
    this.retainedBytes = 0;
    this.truncated = false;
    this.spill = spill;
  }

  append(value) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'utf8');
    if (!chunk.length) return;
    const wasTruncated = this.truncated;
    this.chunks.push(chunk);
    this.retainedBytes += chunk.length;
    if (!wasTruncated && this.retainedBytes <= this.maxBytes) return;
    if (!wasTruncated) {
      this.truncated = true;
      this.spill?.start(Buffer.concat(this.chunks, this.retainedBytes));
    } else {
      this.spill?.append(chunk);
    }
    this.trimTo(Math.max(0, this.maxBytes - TRUNCATED_OUTPUT_MARKER_BYTES));
  }

  trimTo(limit) {
    while (this.retainedBytes > limit && this.chunks.length) {
      const excess = this.retainedBytes - limit;
      const first = this.chunks[0];
      if (first.length <= excess) {
        this.chunks.shift();
        this.retainedBytes -= first.length;
        continue;
      }
      this.chunks[0] = first.subarray(excess);
      this.retainedBytes -= excess;
    }
  }

  text() {
    const tail = Buffer.concat(this.chunks, this.retainedBytes).toString('utf8');
    if (!this.truncated) return tail;
    return TRUNCATED_OUTPUT_MARKER + tail.replace(/^\uFFFD+/u, '');
  }
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
