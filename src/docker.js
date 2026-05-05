const { runProcess, summarizeCommand } = require("./process");
const { safeCommandPolicy } = require("./safety");

function validateImage(workspace, image) {
  const value = String(image || workspace.defaultDockerImage || "").trim();
  if (!value) throw new Error("Docker image is required. Configure defaultDockerImage or pass image.");
  if (!/^[A-Za-z0-9._/:@-]{1,200}$/.test(value)) throw new Error(`Unsafe Docker image value: ${value}`);
  const allowed = workspace.allowedDockerImages || [];
  if (allowed.length > 0 && !allowed.includes(value)) throw new Error(`Docker image '${value}' is not allowlisted for workspace '${workspace.alias}'.`);
  return value;
}

function resolveDockerCommand(workspace, args = {}) {
  if (args.testCommandKey) {
    const command = workspace.testCommands && workspace.testCommands[args.testCommandKey];
    if (!command) throw new Error(`Test command key '${args.testCommandKey}' is not configured for workspace '${workspace.alias}'.`);
    return { key: args.testCommandKey, kind: "test", command };
  }
  if (args.commandKey) {
    const command = workspace.commands && workspace.commands[args.commandKey];
    if (!command) throw new Error(`Command key '${args.commandKey}' is not configured for workspace '${workspace.alias}'.`);
    return { key: args.commandKey, kind: "command", command };
  }
  throw new Error("Use commandKey or testCommandKey for Docker runs.");
}

async function runDocker(config, workspace, args = {}) {
  if (!config.allowDocker && !workspace.allowDocker) {
    throw new Error("Docker runner is disabled. Set allowDocker: true globally or for this workspace.");
  }
  const image = validateImage(workspace, args.image);
  const resolved = resolveDockerCommand(workspace, args);
  safeCommandPolicy(resolved.command);
  const dockerArgs = ["run", "--rm", "-v", `${workspace.path}:/workspace`, "-w", "/workspace"];
  if (args.network === "none" || workspace.dockerNetworkNone !== false) dockerArgs.push("--network", "none");
  if (workspace.dockerUser) dockerArgs.push("--user", String(workspace.dockerUser));
  dockerArgs.push(image, "sh", "-lc", resolved.command);
  const result = await runProcess("docker", dockerArgs, { cwd: workspace.path, shell: false }, config);
  return { ok: result.exitCode === 0, image, commandKey: resolved.key, kind: resolved.kind, command: resolved.command, result: summarizeCommand(result) };
}

module.exports = { runDocker };
