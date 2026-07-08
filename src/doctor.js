const fs = require("node:fs");
const { runProcess, summarizeCommand } = require("./process");

async function doctor(config, _args = {}) {
  const checks = [];
  checks.push(
    await binaryCheck("node", ["--version"], process.cwd(), config),
    await binaryCheck("git", ["--version"], process.cwd(), config)
  );
  const findings = [];
  if (!config.trustedLocalAgent) findings.push("trustedLocalAgent should stay enabled for the local repo bridge.");
  for (const [alias, workspace] of Object.entries(config.workspaces || {})) {
    if (!workspace.path || !fs.existsSync(workspace.path)) findings.push(`Workspace '${alias}' path does not exist: ${workspace.path}`);
  }
  return { ok: checks.every((c) => c.ok) && findings.length === 0, checks, findings };
}

async function binaryCheck(command, args, cwd, config) {
  const result = await runProcess(command, args, { cwd, shell: false }, config);
  return { command, ok: result.exitCode === 0, result: summarizeCommand(result) };
}

module.exports = { doctor };
