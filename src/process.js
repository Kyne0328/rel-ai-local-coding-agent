const { spawn, spawnSync } = require("node:child_process");

// Kill the whole process tree. A plain child.kill() on Windows only terminates the
// direct child — with shell:true that is cmd.exe, leaving npm/node grandchildren
// running (and holding workspace files) after a check times out.
function killProcessTree(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32" && child.pid) {
    try {
      spawnSync("taskkill", ["/f", "/t", "/pid", String(child.pid)], { stdio: "ignore", windowsHide: true, env: { ...process.env } });
      return;
    } catch {}
  }
  try { child.kill("SIGTERM"); } catch {}
}

function runProcess(command, args, options = {}, config = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const maxOutputBytes = config.maxOutputBytes || 1024 * 1024;
    const timeoutMs = Number.isFinite(Number(options.timeout)) && Number(options.timeout) > 0
      ? Number(options.timeout)
      : 0;
    const child = options.shell
      ? spawn(options.commandString || command, { cwd: options.cwd, shell: true, env: makeEnv(options.env) })
      : spawn(command, args || [], { cwd: options.cwd, shell: false, env: makeEnv(options.env) });

    let timer = null;
    function finish(payload) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(payload);
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        stderr = appendLimited(stderr, `\n[rel-ai-mcp timed out after ${timeoutMs}ms]\n`, maxOutputBytes);
        killProcessTree(child);
        finish({
          exitCode: -1,
          signal: "SIGTERM",
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error: `Timed out after ${timeoutMs}ms`
        });
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    }

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk.toString("utf8"), maxOutputBytes);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk.toString("utf8"), maxOutputBytes);
    });
    child.on("error", (error) => {
      if (settled) return;
      finish({ exitCode: -1, signal: undefined, stdout: stdout.trim(), stderr: stderr.trim(), error: error.message });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      finish({
        exitCode: typeof code === "number" ? code : -1,
        signal: signal || undefined,
        stdout: stdout.trim(),
        stderr: stderr.trim()
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
