const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function getConfigPath() {
  return process.env.REL_AI_MCP_CONFIG || path.join(os.homedir(), ".rel-ai-mcp", "config.json");
}

function makeDefaultConfig() {
  return {
    version: 1,
    stateDir: path.join(os.homedir(), ".rel-ai-mcp"),
    auditLogPath: "",
    maxReadFileBytes: 300000,
    maxWriteFileBytes: 600000,
    maxSearchFileBytes: 300000,
    maxOutputBytes: 2 * 1024 * 1024,
    commandTimeoutMs: 20 * 60 * 1000,
    maxTreeEntries: 12000,
    maxSessionSteps: 1000,
    worktreeRoot: path.join(os.homedir(), ".rel-ai-mcp", "worktrees"),
    permissionProfile: "pr",
    allowGitHubCli: false,
    allowDocker: false,
    allowArbitraryCommands: false,
    allowDestructiveTools: false,
    workspaces: {}
  };
}

function readConfig(options = {}) {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    if (options.allowMissing) return makeDefaultConfig();
    throw new Error(`Rel.AI MCP config not found: ${configPath}. Run: npm run init-config`);
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw);
  return normalizeConfig(parsed);
}

function writeConfig(config, options = {}) {
  const configPath = getConfigPath();
  if (options.overwrite === false && fs.existsSync(configPath)) {
    throw new Error(`Config already exists: ${configPath}`);
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const normalized = normalizeConfig(config);
  fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  return normalized;
}

function expandHome(value) {
  const text = String(value || "");
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return text;
}

function normalizeConfig(config) {
  const base = makeDefaultConfig();
  const next = {
    ...base,
    ...(config || {}),
    workspaces: { ...((config && config.workspaces) || {}) }
  };

  next.stateDir = expandHome(next.stateDir || base.stateDir);
  if (!path.isAbsolute(next.stateDir)) next.stateDir = path.resolve(next.stateDir);
  next.auditLogPath = next.auditLogPath ? expandHome(next.auditLogPath) : path.join(next.stateDir, "audit.jsonl");
  if (!path.isAbsolute(next.auditLogPath)) next.auditLogPath = path.resolve(next.auditLogPath);
  next.worktreeRoot = expandHome(next.worktreeRoot || path.join(next.stateDir, "worktrees"));
  if (!path.isAbsolute(next.worktreeRoot)) next.worktreeRoot = path.resolve(next.worktreeRoot);
  next.permissionProfile = String(next.permissionProfile || "pr");

  for (const key of ["maxReadFileBytes", "maxWriteFileBytes", "maxSearchFileBytes", "maxOutputBytes", "commandTimeoutMs", "maxTreeEntries", "maxSessionSteps"]) {
    if (!Number.isFinite(next[key]) || next[key] <= 0) next[key] = base[key];
  }
  next.allowGitHubCli = Boolean(next.allowGitHubCli);
  next.allowDocker = Boolean(next.allowDocker);
  next.allowArbitraryCommands = Boolean(next.allowArbitraryCommands);
  next.allowDestructiveTools = Boolean(next.allowDestructiveTools);

  for (const [alias, workspace] of Object.entries(next.workspaces)) {
    next.workspaces[alias] = normalizeWorkspace(workspace || {});
  }
  return next;
}

function normalizeWorkspace(workspace) {
  return {
    path: workspace.path,
    testCommands: workspace.testCommands || {},
    commands: workspace.commands || {},
    protectedBranches: workspace.protectedBranches || ["main", "master"],
    defaultBaseBranch: workspace.defaultBaseBranch || "main",
    allowedRemotes: Array.isArray(workspace.allowedRemotes) ? workspace.allowedRemotes : ["origin"],
    repoSlug: workspace.repoSlug || "",
    worktreeRoot: workspace.worktreeRoot || "",
    defaultDockerImage: workspace.defaultDockerImage || "",
    allowedDockerImages: Array.isArray(workspace.allowedDockerImages) ? workspace.allowedDockerImages : [],
    dockerUser: workspace.dockerUser || "",
    dockerNetworkNone: workspace.dockerNetworkNone !== false,
    allowDocker: Boolean(workspace.allowDocker),
    allowArbitraryCommands: Boolean(workspace.allowArbitraryCommands),
    allowDestructiveTools: Boolean(workspace.allowDestructiveTools)
  };
}

function resolveWorkspace(config, alias) {
  const key = String(alias || "").trim();
  if (!key) throw new Error("workspace alias is required.");
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(key)) {
    throw new Error(`Invalid workspace alias: ${key}`);
  }
  const entry = config.workspaces && config.workspaces[key];
  if (!entry) throw new Error(`Workspace '${key}' is not configured.`);
  if (!path.isAbsolute(entry.path)) throw new Error(`Workspace '${key}' path must be absolute.`);
  if (!fs.existsSync(entry.path)) throw new Error(`Workspace '${key}' path does not exist: ${entry.path}`);
  const realRoot = fs.realpathSync(entry.path);
  return {
    alias: key,
    path: realRoot,
    testCommands: entry.testCommands || {},
    commands: entry.commands || {},
    protectedBranches: entry.protectedBranches || ["main", "master"],
    defaultBaseBranch: entry.defaultBaseBranch || "main",
    allowedRemotes: entry.allowedRemotes || ["origin"],
    repoSlug: entry.repoSlug || "",
    worktreeRoot: entry.worktreeRoot ? expandHome(entry.worktreeRoot) : config.worktreeRoot,
    defaultDockerImage: entry.defaultDockerImage || "",
    allowedDockerImages: entry.allowedDockerImages || [],
    dockerUser: entry.dockerUser || "",
    dockerNetworkNone: entry.dockerNetworkNone !== false,
    allowDocker: Boolean(entry.allowDocker || config.allowDocker),
    allowArbitraryCommands: Boolean(entry.allowArbitraryCommands || config.allowArbitraryCommands),
    allowDestructiveTools: Boolean(entry.allowDestructiveTools || config.allowDestructiveTools)
  };
}

function publicConfigSummary(config) {
  return {
    configPath: getConfigPath(),
    stateDir: config.stateDir,
    auditLogPath: config.auditLogPath,
    maxReadFileBytes: config.maxReadFileBytes,
    maxWriteFileBytes: config.maxWriteFileBytes,
    maxSearchFileBytes: config.maxSearchFileBytes,
    maxOutputBytes: config.maxOutputBytes,
    commandTimeoutMs: config.commandTimeoutMs,
    maxTreeEntries: config.maxTreeEntries,
    maxSessionSteps: config.maxSessionSteps,
    worktreeRoot: config.worktreeRoot,
    permissionProfile: config.permissionProfile,
    allowGitHubCli: Boolean(config.allowGitHubCli),
    allowDocker: Boolean(config.allowDocker),
    allowArbitraryCommands: Boolean(config.allowArbitraryCommands),
    allowDestructiveTools: Boolean(config.allowDestructiveTools),
    workspaces: Object.entries(config.workspaces || {}).map(([alias, entry]) => ({
      alias,
      path: entry.path,
      testCommandKeys: Object.keys(entry.testCommands || {}).sort(),
      commandKeys: Object.keys(entry.commands || {}).sort(),
      protectedBranches: entry.protectedBranches || ["main", "master"],
      defaultBaseBranch: entry.defaultBaseBranch || "main",
      allowedRemotes: entry.allowedRemotes || ["origin"],
      repoSlug: entry.repoSlug || "",
      worktreeRoot: entry.worktreeRoot || "",
      defaultDockerImage: entry.defaultDockerImage || "",
      allowedDockerImages: entry.allowedDockerImages || [],
      allowDocker: Boolean(entry.allowDocker),
      allowArbitraryCommands: Boolean(entry.allowArbitraryCommands),
      allowDestructiveTools: Boolean(entry.allowDestructiveTools)
    })).sort((a, b) => a.alias.localeCompare(b.alias))
  };
}

module.exports = {
  getConfigPath,
  makeDefaultConfig,
  readConfig,
  writeConfig,
  normalizeConfig,
  expandHome,
  resolveWorkspace,
  publicConfigSummary
};
