const { spawn, spawnSync } = require("node:child_process");
const { resolveGitExecutable } = require("./gitExecutable");
const TASKKILL_EXE = String.raw`C:\Windows\System32\taskkill.exe`;

// Kill the whole process tree. A plain child.kill() on Windows only terminates the
// direct child — with shell:true that is cmd.exe, leaving npm/node grandchildren
// running (and holding workspace files) after a check times out.
function killProcessTree(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32" && child.pid) {
    try {
      spawnSync(TASKKILL_EXE, ["/f", "/t", "/pid", String(child.pid)], { stdio: "ignore", windowsHide: true });
      return;
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] taskkill:', error);
    }
  }
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] kill process group:', error);
    }
  }
  try { child.kill("SIGTERM"); } catch (error) { if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] kill SIGTERM:', error); }
}

function runProcess(command, args, options = {}, config = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    const configuredMaxOutputBytes = Number(options.maxOutputBytes ?? config.maxOutputBytes ?? 1024 * 1024);
    const maxOutputBytes = Number.isFinite(configuredMaxOutputBytes) && configuredMaxOutputBytes > 0
      ? configuredMaxOutputBytes
      : 1024 * 1024;
    const timeoutMs = Number.isFinite(Number(options.timeout)) && Number(options.timeout) > 0
      ? Number(options.timeout)
      : 0;
    const executable = command === "git" ? (resolveGitExecutable() || command) : command;
    const spawnOptions = {
      cwd: options.cwd,
      env: makeEnv(options.env),
      detached: process.platform !== "win32",
      windowsHide: true
    };
    const child = options.shell
      ? spawn(options.commandString || executable, { ...spawnOptions, shell: true })
      : spawn(executable, args || [], { ...spawnOptions, shell: false });
    const abortSignal = options.signal;
    const onAbort = () => {
      if (settled) return;
      const marker = '\n[rel-ai-mcp operation cancelled]\n';
      stderrTruncated = stderrTruncated || Buffer.byteLength(stderr + marker, 'utf8') > maxOutputBytes;
      stderr = appendLimited(stderr, marker, maxOutputBytes);
      killProcessTree(child);
      finish({
        exitCode: -1,
        signal: 'SIGTERM',
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: 'Operation cancelled.',
        cancelled: true,
        timedOut: false
      });
    };
    if (abortSignal?.aborted) onAbort();
    else abortSignal?.addEventListener?.('abort', onAbort, { once: true });

    if (child.stdin) {
      if (options.input != null) child.stdin.end(String(options.input));
      else child.stdin.end();
    }

    let timer = null;
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

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        const marker = `\n[rel-ai-mcp timed out after ${timeoutMs}ms]\n`;
        stderrTruncated = stderrTruncated || Buffer.byteLength(stderr + marker, "utf8") > maxOutputBytes;
        stderr = appendLimited(stderr, marker, maxOutputBytes);
        killProcessTree(child);
        finish({
          exitCode: -1,
          signal: "SIGTERM",
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error: `Timed out after ${timeoutMs}ms`,
          timedOut: true
        });
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    }

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdoutBytes += Buffer.byteLength(text, "utf8");
      stdoutTruncated = stdoutTruncated || stdoutBytes > maxOutputBytes;
      stdout = appendLimited(stdout, text, maxOutputBytes);
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderrBytes += Buffer.byteLength(text, "utf8");
      stderrTruncated = stderrTruncated || stderrBytes > maxOutputBytes;
      stderr = appendLimited(stderr, text, maxOutputBytes);
    });
    child.on("error", (error) => {
      if (settled) return;
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
    child.on("close", (code, signal) => {
      if (settled) return;
      finish({
        exitCode: typeof code === "number" ? code : -1,
        signal: signal || undefined,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut: false
      });
    });
  });
}

function makeEnv(extra) {
  const env = { ...process.env, REL_AI_MCP: "1" };
  if (extra && typeof extra === "object") Object.assign(env, extra);
  return env;
}

function appendLimited(current, next, maxBytes) {
  const combined = current + next;
  if (Buffer.byteLength(combined, "utf8") <= maxBytes) return combined;
  const marker = "\n[rel-ai-mcp truncated output]\n";
  const allowed = Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8"));
  const buffer = Buffer.from(combined, "utf8");
  const tail = buffer.subarray(Math.max(0, buffer.length - allowed)).toString("utf8").replace(/^\uFFFD+/u, "");
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
    ...(result.stdout ? { stdout: result.stdout } : {}),
    ...(result.stderr ? { stderr: result.stderr } : {})
  };
}

module.exports = {
  runProcess,
  summarizeCommand,
  appendLimited,
  killProcessTree
};
