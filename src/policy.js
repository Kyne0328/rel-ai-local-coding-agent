function policySummary(config) {
  return {
    ok: true,
    permissionProfile: config.permissionProfile,
    approvalGates: config.approvalGates,
    allowArbitraryCommands: Boolean(config.allowArbitraryCommands),
    allowDestructiveTools: Boolean(config.allowDestructiveTools),
    allowDocker: Boolean(config.allowDocker),
    allowGitHubCli: Boolean(config.allowGitHubCli),
    sandboxMode: config.sandboxMode,
    multiAgent: config.multiAgent,
    policies: config.policies || {},
    recommendations: recommendations(config)
  };
}

function evaluatePolicy(config, args = {}) {
  const action = String(args.action || "").trim();
  if (!action) throw new Error("action is required.");
  const warnings = [];
  const denied = [];
  if (["push", "pr", "merge", "reset", "worktree-remove"].includes(action) && config.approvalGates?.[action] !== true) warnings.push(`${action} is not approval-gated.`);
  if (action === "command" && !config.allowArbitraryCommands && !args.commandKey) denied.push("Arbitrary commands are disabled; use commandKey.");
  if (action === "docker" && !config.allowDocker) denied.push("Docker is disabled.");
  if (["reset", "worktree-remove"].includes(action) && !config.allowDestructiveTools && !args.sessionId) denied.push(`${action} requires a task session or allowDestructiveTools.`);
  return { ok: denied.length === 0, action, denied, warnings, approvalRequired: Boolean(config.approvalGates?.[action]) };
}

function recommendations(config) {
  const out = [];
  if (config.allowArbitraryCommands) out.push("Disable allowArbitraryCommands for normal ChatGPT use.");
  if (!config.approvalGates?.push) out.push("Enable approvalGates.push before using remote MCP over a tunnel.");
  if (!config.approvalGates?.merge) out.push("Enable approvalGates.merge for multi-agent merge-back.");
  if (config.permissionProfile === "admin") out.push("Use admin only for maintenance; prefer pr/test profiles during normal tasks.");
  return out;
}

module.exports = { policySummary, evaluatePolicy };
