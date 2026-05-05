const { spawn } = require("node:child_process");

function runProcess(command, args, options = {}, config = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const maxOutputBytes = config.maxOutputBytes || 1024 * 1024;
    const timeoutMs = config.commandTimeoutMs || 15 * 60 * 1000;
    const child = options.shell
      ? spawn(options.commandString || command, { cwd: options.cwd, shell: true, env: makeEnv(options.env) })
      : spawn(command, args || [], { cwd: options.cwd, shell: false, env: makeEnv(options.env) });

    const timer = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        child.kill("SIGTERM");
      }
    }, timeoutMs);

    const forceTimer = setTimeout(() => {
      if (!settled && timedOut) child.kill("SIGKILL");
    }, timeoutMs + 5000);

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk.toString("utf8"), maxOutputBytes);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk.toString("utf8"), maxOutputBytes);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      resolve({ exitCode: -1, signal: undefined, stdout: stdout.trim(), stderr: stderr.trim(), error: error.message, timedOut, timeoutMs });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      resolve({
        exitCode: typeof code === "number" ? code : -1,
        signal: signal || undefined,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
        timeoutMs
      });
    });
  });
}

function makeEnv(extra) {
  return {
    ...process.env,
    ...(extra || {}),
    REL_AI_MCP: "1"
  };
}

function appendLimited(current, next, maxBytes) {
  const combined = current + next;
  if (Buffer.byteLength(combined, "utf8") <= maxBytes) return combined;
  const marker = "\n[rel-ai-mcp truncated output]\n";
  const allowed = Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8"));
  return combined.slice(Math.max(0, combined.length - allowed)) + marker;
}

function summarizeCommand(result) {
  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    ...(result.signal ? { signal: result.signal } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(result.timedOut ? { timedOut: true, timeoutMs: result.timeoutMs } : {}),
    ...(result.stdout ? { stdout: result.stdout } : {}),
    ...(result.stderr ? { stderr: result.stderr } : {})
  };
}

module.exports = {
  runProcess,
  summarizeCommand,
  appendLimited
};
