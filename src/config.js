const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function getConfigPath() {
  return process.env.REL_AI_MCP_CONFIG || path.join(os.homedir(), ".rel-ai-mcp", "config.json");
}

function makeDefaultConfig() {
  return {
    version: 1,
    maxReadFileBytes: 200000,
    maxSearchFileBytes: 200000,
    maxOutputBytes: 1024 * 1024,
    commandTimeoutMs: 15 * 60 * 1000,
    maxTreeEntries: 1500,
    allowGitHubCli: false,
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

function normalizeConfig(config) {
  const base = makeDefaultConfig();
  const next = {
    ...base,
    ...(config || {}),
    workspaces: { ...((config && config.workspaces) || {}) }
  };
  if (!Number.isFinite(next.maxReadFileBytes) || next.maxReadFileBytes <= 0) next.maxReadFileBytes = base.maxReadFileBytes;
  if (!Number.isFinite(next.maxSearchFileBytes) || next.maxSearchFileBytes <= 0) next.maxSearchFileBytes = base.maxSearchFileBytes;
  if (!Number.isFinite(next.maxOutputBytes) || next.maxOutputBytes <= 0) next.maxOutputBytes = base.maxOutputBytes;
  if (!Number.isFinite(next.commandTimeoutMs) || next.commandTimeoutMs <= 0) next.commandTimeoutMs = base.commandTimeoutMs;
  if (!Number.isFinite(next.maxTreeEntries) || next.maxTreeEntries <= 0) next.maxTreeEntries = base.maxTreeEntries;

  for (const [alias, workspace] of Object.entries(next.workspaces)) {
    next.workspaces[alias] = {
      path: workspace.path,
      testCommands: workspace.testCommands || {},
      protectedBranches: workspace.protectedBranches || ["main", "master"]
    };
  }
  return next;
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
    protectedBranches: entry.protectedBranches || ["main", "master"]
  };
}

function publicConfigSummary(config) {
  return {
    configPath: getConfigPath(),
    maxReadFileBytes: config.maxReadFileBytes,
    maxSearchFileBytes: config.maxSearchFileBytes,
    maxOutputBytes: config.maxOutputBytes,
    commandTimeoutMs: config.commandTimeoutMs,
    maxTreeEntries: config.maxTreeEntries,
    allowGitHubCli: Boolean(config.allowGitHubCli),
    workspaces: Object.entries(config.workspaces || {}).map(([alias, entry]) => ({
      alias,
      path: entry.path,
      testCommandKeys: Object.keys(entry.testCommands || {}).sort(),
      protectedBranches: entry.protectedBranches || ["main", "master"]
    })).sort((a, b) => a.alias.localeCompare(b.alias))
  };
}

module.exports = {
  getConfigPath,
  makeDefaultConfig,
  readConfig,
  writeConfig,
  resolveWorkspace,
  publicConfigSummary
};
