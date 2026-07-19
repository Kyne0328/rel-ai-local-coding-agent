// Terminating a spawned child process across platforms.
//
// On Windows the ngrok agent can outlive a plain child.kill(), so the whole
// process tree is killed via taskkill; POSIX gets a normal SIGTERM.
function logKillDebug(label, error) {
  if (process.env.REL_AI_MCP_DEBUG) console.error(label, error);
}

function killChildFallback(child) {
  try {
    child.kill();
  } catch (error) {
    logKillDebug('[rel-ai-mcp] kill fallback:', error);
  }
}

function killWindowsProcessTree(child) {
  try {
    const { spawnSync } = require("node:child_process");
    spawnSync(String.raw`C:\Windows\System32\taskkill.exe`, ["/f", "/t", "/pid", String(child.pid)], { stdio: "ignore", windowsHide: true });
  } catch (error) {
    logKillDebug('[rel-ai-mcp] taskkill:', error);
    killChildFallback(child);
  }
}

function terminateChild(child) {
  try {
    child.kill("SIGTERM");
  } catch (error) {
    logKillDebug('[rel-ai-mcp] kill SIGTERM:', error);
  }
}

function killProcess(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32" && child.pid) {
    killWindowsProcessTree(child);
    return;
  }
  terminateChild(child);
}

module.exports = { killProcess };
