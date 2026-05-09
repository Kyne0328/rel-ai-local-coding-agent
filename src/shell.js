const { runProcess, summarizeCommand } = require("./process");
const { resolveSafePath } = require("./safety");

async function runShellCommand(workspace, config, args = {}) {
  if (!workspace.allowArbitraryCommands) {
    throw new Error(
      `relai_shell requires allowArbitraryCommands: true for workspace '${workspace.alias}'. ` +
      "Set it in config.json or enable agentMode: true."
    );
  }

  const command = String(args.command || "").trim();
  if (!command) throw new Error("command is required.");

  let cwd = workspace.path;
  if (args.cwd) {
    const safe = resolveSafePath(workspace.path, String(args.cwd));
    cwd = safe.absolutePath;
  }

  const timeoutMs = args.timeoutMs
    ? Math.min(Math.max(Number(args.timeoutMs), 1000), 600000)
    : 120000;

  const env = args.env && typeof args.env === "object"
    ? { ...process.env, ...Object.fromEntries(Object.entries(args.env).map(([k, v]) => [k, String(v)])) }
    : undefined;

  const result = await runProcess(command, [], { cwd, shell: true, commandString: command, env, timeout: timeoutMs }, config);
  return {
    ok: result.exitCode === 0,
    workspace: workspace.alias,
    command,
    cwd,
    ...summarizeCommand(result)
  };
}

module.exports = { runShellCommand };
