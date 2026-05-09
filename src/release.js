const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const { getConfigPath, publicConfigSummary, resolveWorkspace, makeDefaultConfig } = require("./config");
const { runProcess, summarizeCommand } = require("./process");
const { discoverCommands } = require("./commandDiscovery");
const { gitStatus } = require("./git");
const pkg = require("../package.json");

function releaseReadiness(config, args = {}) {
  const findings = [];
  const summary = publicConfigSummary(config);
  const workspaces = Object.keys(config.workspaces || {});

  checkFile(findings, "package.json", path.join(projectRoot(), "package.json"), "error");
  checkFile(findings, "README.md", path.join(projectRoot(), "README.md"), "warning");
  checkFile(findings, ".gitattributes", path.join(projectRoot(), ".gitattributes"), "warning");
  checkFile(findings, ".editorconfig", path.join(projectRoot(), ".editorconfig"), "warning");
  checkDir(findings, "stateDir", config.stateDir, "error");
  checkDir(findings, "worktreeRoot", config.worktreeRoot, "warning");

  if (workspaces.length === 0) {
    findings.push(finding("warning", "no_workspaces", "No workspaces are configured yet."));
  }
  if (!process.env.REL_AI_MCP_TOKEN && args.requireHttpToken !== false) {
    findings.push(finding("warning", "missing_http_token_env", "REL_AI_MCP_TOKEN is not set in the current environment. Set it before exposing /mcp."));
  }
  if (config.trustedLocalAgent) {
    findings.push(finding("info", "trusted_local_agent", "Trusted ChatGPT local repo mode is enabled. Shell, write, verify, diff, and reset are intentionally available inside configured workspaces."));
  } else {
    findings.push(finding("warning", "trusted_local_agent_disabled", "Trusted local mode is disabled. ChatGPT may be blocked from writing or running verification."));
  }

  const commandChecks = checkCommandAvailability(["git", "node"], findings);
  if (config.allowGitHubCli) checkCommandAvailability(["gh"], findings);
  if (config.allowDocker || config.sandboxMode === "docker" || config.sandboxMode === "docker_readonly_base") checkCommandAvailability(["docker"], findings);

  const score = scoreFindings(findings);
  return {
    ok: !findings.some((item) => item.severity === "error"),
    score,
    rating: readinessRating(score),
    generatedAt: new Date().toISOString(),
    package: { name: pkg.name, version: pkg.version, node: process.version },
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
    findings.push(finding("warning", "on_protected_branch", `Workspace is currently on protected branch '${branchName}'. Use a task worktree or feature branch.`));
  }

  const status = await gitStatus(workspace, config);
  checks.push({ name: "git_status", ok: status.ok, dirty: Boolean(status.stdout && status.stdout.trim()), status });
  if (status.stdout && status.stdout.trim() && args.requireClean !== false) {
    findings.push(finding("warning", "dirty_worktree", "Workspace has uncommitted changes. Prefer starting a task worktree before agent edits."));
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

async function connectorCheck(_config, args = {}) {
  const endpoint = String(args.endpoint || args.baseUrl || "").trim();
  const token = String(args.token || process.env.REL_AI_MCP_TOKEN || "").trim();
  const findings = [];
  if (!endpoint) findings.push(finding("error", "missing_endpoint", "Provide endpoint, usually the secret ChatGPT URL printed by npm run connector:print, for example https://your-domain.example.com/mcp/<secret>."));
  let parsed = null;
  if (endpoint) {
    try {
      parsed = new URL(endpoint);
      if (!["http:", "https:"].includes(parsed.protocol)) findings.push(finding("error", "invalid_scheme", "Endpoint must use http:// or https://."));
      if (parsed.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) findings.push(finding("warning", "plain_http_remote", "Use HTTPS when endpoint is not local."));
      if (parsed.pathname === "/mcp") findings.push(finding("warning", "bearer_endpoint_for_chatgpt", "ChatGPT Developer Mode does not use arbitrary bearer-token auth here. Prefer the secret URL path printed as chatgptMcpUrl and choose No Authentication."));
      else if (!parsed.pathname.startsWith("/mcp/")) findings.push(finding("info", "nonstandard_path", "For ChatGPT use the secret /mcp/<secret> URL printed by npm run connector:print."));
    } catch (error) {
      findings.push(finding("error", "invalid_endpoint", `Invalid endpoint URL: ${error.message}`));
    }
  }
  if (!token) findings.push(finding("info", "missing_token", "No bearer token provided. That is expected when ChatGPT uses the secret /mcp/<secret> URL with No Authentication."));

  let probe = null;
  if (args.probe === true && parsed) {
    probe = await probeHealth(parsed, token, Number(args.timeoutMs || 5000));
    if (!probe.ok) findings.push(finding("warning", "probe_failed", `Endpoint probe failed: ${probe.error || probe.statusCode || "unknown"}`));
  }

  const base = parsed ? `${parsed.protocol}//${parsed.host}` : "https://your-domain.example.com";
  return {
    ok: !findings.some((item) => item.severity === "error"),
    endpoint,
    healthEndpoint: `${base}/health`,
    dashboardEndpoint: `${base}/dashboard`,
    authHeader: token ? "Authorization: Bearer <provided token>" : "not used by ChatGPT No Authentication mode",
    suggestedChatGPTConnector: {
      name: "Rel.AI MCP",
      url: endpoint || `${base}/mcp/<secret>`,
      authentication: "No Authentication"
    },
    curl: endpoint ? `curl -sS ${base}/health` : "",
    probe,
    findings,
    nextActions: nextActions(findings)
  };
}

function configMigrationPlan(config, args = {}) {
  const defaults = makeDefaultConfig();
  const current = publicConfigSummary(config);
  const added = [];
  const missing = [];
  diffKeys("", defaults, config, added, missing);
  return {
    ok: true,
    fromVersion: args.fromVersion || "unknown",
    toVersion: pkg.version,
    configPath: getConfigPath(),
    addedDefaultKeys: added,
    missingKeysInCurrentConfig: missing,
    current,
    recommendedActions: [
      "Back up config.json before upgrading.",
      "Run relai_release_readiness after migration.",
      "Keep approval gates enabled for push, pr, reset, and merge."
    ]
  };
}

function releaseManifest(_config, args = {}) {
  const root = projectRoot();
  const files = [];
  walkProject(root, root, files, Number(args.maxFiles || 10000), Number(args.maxFileBytes || 1024 * 1024));
  const totalBytes = files.reduce((sum, item) => sum + item.size, 0);
  return {
    ok: true,
    name: pkg.name,
    version: pkg.version,
    generatedAt: new Date().toISOString(),
    root,
    fileCount: files.length,
    totalBytes,
    files
  };
}

function releaseNotes(_config, args = {}) {
  const version = args.version || pkg.version;
  return {
    ok: true,
    version,
    title: `Rel.AI MCP v${version}`,
    commitMessage: "fix: allow workspace diagnostics in pr profile",
    tagMessage: `Rel.AI MCP v${version}: workspace diagnostics and no-auth ChatGPT guidance`,
    bullets: [
      "Allows relai_workspace_list and relai_workspace_inspect under read-only/pr profiles so the first diagnostic prompt works without admin mode.",
      "Keeps one-command local startup with persistent token generation and saved connector profiles.",
      "Keeps relai_workspace_list and relai_workspace_inspect for reliable first-call workspace discovery.",
      "Adds read-only MCP resources for connector help, configured workspaces, workspace profile, and workspace tree discovery.",
      "Adds stable public URL support so one ChatGPT app can point at a permanent secret /mcp/<secret> endpoint.",
      "Adds a ChatGPT-compatible No Authentication URL path because Developer Mode does not import tools through arbitrary bearer-token headers.",
      "Adds dashboard connector setup guidance and a /api/connection helper endpoint.",
      "Keeps release-readiness scoring for config, approval gates, command availability, state directories, and workspace setup.",
      "Keeps connector verification helpers for ChatGPT Developer Mode endpoint/token setup.",
      "Adds workspace preflight checks for Git repo state, protected branches, line-ending files, and allowlisted tests.",
      "Adds config migration planning against the current default schema.",
      "Adds release manifest generation for packaged ZIP review and reproducibility.",
      "Adds dashboard APIs for readiness and release manifest data."
    ],
    commands: [
      "npm run check",
      "npm run test:smoke",
      "npm run test:http",
      "npm run test:v10"
    ]
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
  const args = [command];
  try {
    const child = require("node:child_process").spawnSync(lookup, args, { shell: false, encoding: "utf8" });
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
    if (item.code === "missing_http_token_env" || item.code === "missing_token") actions.push("Use the printed /mcp/<secret> ChatGPT MCP URL and set ChatGPT authentication to No Authentication. Keep REL_AI_MCP_TOKEN only for local/API bearer clients.");
    else if (item.code === "no_workspaces") actions.push("Run npm run workspace:add -- <alias> <absolute-project-path>.");
    else if (item.code === "no_test_commands") actions.push("Add at least one allowlisted test command with npm run testcmd:add.");
    else if (item.code === "dirty_worktree") actions.push("Commit/stash local changes or create a task worktree before running agents.");
    else if (item.code === "trusted_local_agent_disabled") actions.push("Enable trusted local mode for the ChatGPT repo bridge.");
    else if (item.code && item.code.includes("gitattributes")) actions.push("Run relai_doctor_fix with workspacePath to add .gitattributes/.editorconfig.");
  }
  return [...new Set(actions)];
}

function finding(severity, code, message, extra = {}) {
  return { severity, code, message, ...extra };
}

function diffKeys(prefix, defaults, current, added, missing) {
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) return;
  for (const key of Object.keys(defaults)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (!current || !Object.prototype.hasOwnProperty.call(current, key)) missing.push(full);
    if (defaults[key] && typeof defaults[key] === "object" && !Array.isArray(defaults[key])) diffKeys(full, defaults[key], current && current[key], added, missing);
  }
  if (current && typeof current === "object" && !Array.isArray(current)) {
    for (const key of Object.keys(current)) {
      const full = prefix ? `${prefix}.${key}` : key;
      if (!Object.prototype.hasOwnProperty.call(defaults, key)) added.push(full);
    }
  }
}

function walkProject(root, current, files, maxFiles, maxFileBytes) {
  if (files.length >= maxFiles) return;
  const skip = new Set(["node_modules", ".git", "coverage", "dist", "build", ".relai", ".rel-ai-mcp"]);
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (files.length >= maxFiles || skip.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) walkProject(root, full, files, maxFiles, maxFileBytes);
    else {
      const stat = fs.statSync(full);
      if (stat.size > maxFileBytes) continue;
      const content = fs.readFileSync(full);
      files.push({
        path: path.relative(root, full).replace(/\\/g, "/"),
        size: stat.size,
        sha256: crypto.createHash("sha256").update(content).digest("hex")
      });
    }
  }
}

function probeHealth(endpoint, token, timeoutMs) {
  return new Promise((resolve) => {
    const healthUrl = new URL("/health", `${endpoint.protocol}//${endpoint.host}`);
    const lib = healthUrl.protocol === "https:" ? https : http;
    const req = lib.request(healthUrl, { method: "GET", timeout: timeoutMs, headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, body: body.slice(0, 2000) }));
    });
    req.on("timeout", () => { req.destroy(new Error("probe timeout")); });
    req.on("error", (error) => resolve({ ok: false, error: error.message }));
    req.end();
  });
}

module.exports = {
  releaseReadiness,
  workspacePreflight,
  connectorCheck,
  configMigrationPlan,
  releaseManifest,
  releaseNotes
};
