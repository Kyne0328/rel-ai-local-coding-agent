const fs = require("node:fs");
const path = require("node:path");
const { publicConfigSummary, resolveWorkspace } = require("./config");
const { runProcess, summarizeCommand } = require("./process");
const { discoverCommands } = require("./commandDiscovery");
const pkg = require("../package.json");
const { getVersion } = require("./version");

function releaseReadiness(config, args = {}) {
  const findings = [];
  const summary = publicConfigSummary(config);
  const workspaces = Object.keys(config.workspaces || {});

  checkFile(findings, "package.json", path.join(projectRoot(), "package.json"), "error");
  checkFile(findings, "README.md", path.join(projectRoot(), "README.md"), "warning");
  checkFile(findings, ".gitattributes", path.join(projectRoot(), ".gitattributes"), "warning");
  checkFile(findings, ".editorconfig", path.join(projectRoot(), ".editorconfig"), "warning");
  checkDir(findings, "stateDir", config.stateDir, "error");

  if (workspaces.length === 0) {
    findings.push(finding("warning", "no_workspaces", "No workspaces are configured yet."));
  }
  if (!process.env.REL_AI_MCP_TOKEN && args.requireHttpToken !== false) {
    findings.push(finding("warning", "missing_http_token_env", "REL_AI_MCP_TOKEN is not set in the current environment. Set it before exposing bearer-auth endpoints."));
  }
  if (config.trustedLocalAgent) {
    findings.push(finding("info", "trusted_local_agent", "Trusted ChatGPT local repo mode is enabled. Read, write, verify, diff, and reset are intentionally available inside configured workspaces."));
  } else {
    findings.push(finding("warning", "trusted_local_agent_disabled", "Trusted local mode is disabled. ChatGPT may be blocked from writing or running verification."));
  }

  const commandChecks = checkCommandAvailability(["git", "node"], findings);
  const score = scoreFindings(findings);
  const minimumReadinessScore = config.release && Number.isFinite(Number(config.release.minimumReadinessScore))
    ? Number(config.release.minimumReadinessScore)
    : 80;
  return {
    ok: !findings.some((item) => item.severity === "error"),
    score,
    minimumReadinessScore,
    meetsMinimum: score >= minimumReadinessScore,
    rating: readinessRating(score),
    generatedAt: new Date().toISOString(),
    package: { name: pkg.name, version: getVersion(), node: process.version },
    config: summary,
    commandChecks,
    workspaces: workspaces.map((alias) => workspaceBrief(config, alias)),
    findings,
    nextActions: nextActions(findings)
  };
}

async function workspacePreflight(config, args = {}) {
  const workspace = resolveWorkspace(config, args.workspace);
  const findings = [];
  const checks = [];
  const root = workspace.path;

  checks.push(checkWorkspaceFile(findings, root, ".gitattributes", "warning", "Add .gitattributes to stop LF/CRLF churn."));
  checks.push(checkWorkspaceFile(findings, root, ".editorconfig", "info", "Add .editorconfig to keep editor defaults consistent."));
  checks.push(checkWorkspaceFile(findings, root, "package.json", "info", "No package.json found; this may be fine for non-Node repos."));

  const gitDir = await runProcess("git", ["rev-parse", "--git-dir"], { cwd: root, shell: false }, config);
  checks.push({ name: "git_repository", ok: gitDir.exitCode === 0, command: "git rev-parse --git-dir", result: summarizeCommand(gitDir) });
  if (gitDir.exitCode !== 0) findings.push(finding("error", "not_git_repo", "Workspace is not a Git repository."));

  const branch = await runProcess("git", ["branch", "--show-current"], { cwd: root, shell: false }, config);
  const branchName = (branch.stdout || "").trim();
  checks.push({ name: "current_branch", ok: branch.exitCode === 0, branch: branchName, result: summarizeCommand(branch) });
  if ((workspace.protectedBranches || []).includes(branchName)) {
    findings.push(finding("warning", "on_protected_branch", `Workspace is currently on protected branch '${branchName}'. Switch to a feature branch before edits.`));
  }

  const statusResult = await runProcess("git", ["status", "--short"], { cwd: root, shell: false }, config);
  const status = summarizeCommand(statusResult);
  checks.push({ name: "git_status", ok: statusResult.exitCode === 0, dirty: Boolean(statusResult.stdout && statusResult.stdout.trim()), status });
  if (statusResult.stdout && statusResult.stdout.trim() && args.requireClean !== false) {
    findings.push(finding("warning", "dirty_worktree", "Workspace has uncommitted changes. Review relai_diff before editing."));
  }

  const commandKeys = Object.keys(workspace.commands || {});
  const testKeys = Object.keys(workspace.testCommands || {});
  const discoveredCommands = discoverCommands(workspace.path);
  const discoveredTestKeys = Object.keys(discoveredCommands).filter((key) => /test|analy[sz]e|lint|check|vet|build/.test(key + " " + discoveredCommands[key]));
  if (testKeys.length === 0 && discoveredTestKeys.length === 0) findings.push(finding("warning", "no_validation_commands", "No configured or discovered validation commands were found for this workspace."));

  return {
    ok: !findings.some((item) => item.severity === "error"),
    score: scoreFindings(findings),
    workspace: workspace.alias,
    path: workspace.path,
    generatedAt: new Date().toISOString(),
    commandKeys,
    testCommandKeys: testKeys,
    discoveredCommandKeys: Object.keys(discoveredCommands).sort(),
    discoveredTestCommandKeys: discoveredTestKeys.sort(),
    checks,
    findings,
    nextActions: nextActions(findings)
  };
}

function projectRoot() {
  return path.resolve(__dirname, "..");
}

function checkDir(findings, label, dir, severity) {
  if (!dir) {
    findings.push(finding(severity, `${label}_missing`, `${label} is not configured.`));
    return false;
  }
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return true;
  } catch (error) {
    findings.push(finding(severity, `${label}_unavailable`, `${label} is unavailable: ${error.message}`));
    return false;
  }
}

function checkFile(findings, label, file, severity) {
  if (!fs.existsSync(file)) {
    findings.push(finding(severity, `${label.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_missing`, `${label} is missing at ${file}.`));
    return false;
  }
  return true;
}

function checkWorkspaceFile(findings, root, relative, severity, message) {
  const file = path.join(root, relative);
  const ok = fs.existsSync(file);
  if (!ok) findings.push(finding(severity, `${relative.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_missing`, message));
  return { name: relative, ok, path: file };
}

function checkCommandAvailability(commands, findings) {
  return commands.map((command) => {
    const result = commandExists(command);
    if (!result.ok) findings.push(finding(command === "git" || command === "node" ? "error" : "warning", `${command}_missing`, `${command} was not found on PATH.`));
    return result;
  });
}

function commandExists(command) {
  const isWindows = process.platform === "win32";
  const lookup = isWindows ? "where" : "which";
  try {
    const child = require("node:child_process").spawnSync(lookup, [command], { shell: false, encoding: "utf8" });
    return { command, ok: child.status === 0, path: (child.stdout || "").trim().split(/\r?\n/)[0] || "" };
  } catch (error) {
    return { command, ok: false, error: error.message };
  }
}

function workspaceBrief(config, alias) {
  try {
    const workspace = resolveWorkspace(config, alias);
    return {
      alias,
      ok: true,
      path: workspace.path,
      testCommandKeys: Object.keys(workspace.testCommands || {}),
      commandKeys: Object.keys(workspace.commands || {}),
      protectedBranches: workspace.protectedBranches || []
    };
  } catch (error) {
    return { alias, ok: false, error: error.message };
  }
}

function scoreFindings(findings) {
  let score = 100;
  for (const item of findings) {
    if (item.severity === "error") score -= 30;
    else if (item.severity === "warning") score -= 10;
    else if (item.severity === "info") score -= 2;
  }
  return Math.max(0, Math.min(100, score));
}

function readinessRating(score) {
  if (score >= 90) return "ready";
  if (score >= 70) return "usable_with_warnings";
  if (score >= 40) return "needs_work";
  return "not_ready";
}

function nextActions(findings) {
  const actions = [];
  for (const item of findings.slice(0, 20)) {
    if (item.code === "missing_http_token_env") actions.push("Use the secret /mcp/<secret> ChatGPT MCP URL with No Authentication. Keep REL_AI_MCP_TOKEN only for local/API bearer clients.");
    else if (item.code === "no_workspaces") actions.push("Run npm run workspace:add -- <alias> <absolute-project-path>.");
    else if (item.code === "no_validation_commands") actions.push("Add a validation command with npm run testcmd:add -- <alias> <key> <command...>.");
    else if (item.code === "dirty_worktree") actions.push("Commit/stash local changes or review relai_diff before further edits.");
    else if (item.code === "trusted_local_agent_disabled") actions.push("Use the default trusted local bridge mode for ChatGPT repo work.");
    else if (item.code && item.code.includes("gitattributes")) actions.push("Run relai-mcp-config doctor --fix <workspace-path> to add .gitattributes/.editorconfig.");
  }
  return [...new Set(actions)];
}

function finding(severity, code, message, extra = {}) {
  return { severity, code, message, ...extra };
}

module.exports = {
  releaseReadiness,
  workspacePreflight
};
