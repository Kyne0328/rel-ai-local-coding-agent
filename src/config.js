const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { safeReadJson } = require("./safety");
const { discoverCommands } = require("./commandDiscovery");

const BRIDGE_TOOLS = ["relai_repo_snapshot", "relai_read", "relai_write", "relai_verify", "relai_browser", "relai_diff", "relai_reset"];

function makeDefaultAutoApproveConfig() {
  return {
    enabled: false,
    pollMs: 1200,
    warningAccepted: false,
    mode: "chrome_extension"
  };
}


function getConfigPath() {
  return process.env.REL_AI_MCP_CONFIG || path.join(os.homedir(), ".rel-ai-mcp", "config.json");
}

function makeDefaultFastTaskConfig() {
  return {
    enabled: true,
    skipIndexForSmallTasks: true,
    preferChangedFiles: true,
    maxIndexFiles: 750,
    includeRoots: [],
    excludePaths: [
      ".git", "node_modules", "build", "dist", "coverage", ".next", ".nuxt", ".svelte-kit",
      ".dart_tool", ".gradle", "target", "bin", "obj", "vendor", ".venv", "venv",
      ".claude/skills", ".superpowers"
    ]
  };
}

function makeDefaultConfig() {
  return {
    version: 2,
    stateDir: path.join(os.homedir(), ".rel-ai-mcp"),
    auditLogPath: "",
    maxOutputBytes: 2 * 1024 * 1024,
    maxIndexFiles: 3000,
    toolMode: "chatgpt_local_repo",
    trustedLocalAgent: true,
    dashboardEnabled: true,
    productUx: {
      dashboardRefreshSeconds: 5,
      liveLogPollSeconds: 3,
      staleHours: 24,
      cleanupOlderThanHours: 168,
      enableStateExport: true
    },
    release: {
      minimumReadinessScore: 80,
      requireHttpToken: true,
      connectorProbeTimeoutMs: 5000,
      enableReleaseEndpoints: true
    },
    autoApproveAppRequests: makeDefaultAutoApproveConfig(),
    workspaces: {}
  };
}

function readConfig(options = {}) {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    if (options.allowMissing) return makeDefaultConfig();
    throw new Error(`Rel.AI MCP config not found: ${configPath}. Run: npm run init-config`);
  }
  const parsed = safeReadJson(configPath);
  if (!parsed) throw new Error(`Config file is corrupted or empty: ${configPath}. Fix or re-run: npm run init-config`);
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
  const input = config || {};
  const next = {
    ...base,
    ...input,
    workspaces: { ...(input.workspaces || {}) }
  };

  next.version = 2;
  next.stateDir = expandHome(next.stateDir || base.stateDir);
  if (!path.isAbsolute(next.stateDir)) next.stateDir = path.resolve(next.stateDir);
  next.auditLogPath = next.auditLogPath ? expandHome(next.auditLogPath) : path.join(next.stateDir, "audit.jsonl");
  if (!path.isAbsolute(next.auditLogPath)) next.auditLogPath = path.resolve(next.auditLogPath);
  next.toolMode = "chatgpt_local_repo";
  next.trustedLocalAgent = true;
  next.dashboardEnabled = next.dashboardEnabled !== false;
  next.maxOutputBytes = positiveNumber(next.maxOutputBytes, base.maxOutputBytes);
  next.maxIndexFiles = positiveNumber(next.maxIndexFiles, base.maxIndexFiles);
  next.productUx = { ...base.productUx, ...(input.productUx || {}) };
  next.release = { ...base.release, ...(input.release || {}) };
  next.autoApproveAppRequests = normalizeAutoApproveConfig(input.autoApproveAppRequests || input.autoApprove || base.autoApproveAppRequests);
  next.release.minimumReadinessScore = clampNumber(next.release.minimumReadinessScore, 0, 100, base.release.minimumReadinessScore);
  next.release.connectorProbeTimeoutMs = clampNumber(next.release.connectorProbeTimeoutMs, 500, 60000, base.release.connectorProbeTimeoutMs);

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
    fastTask: normalizeFastTask(workspace.fastTask)
  };
}

function normalizeFastTask(value) {
  const base = makeDefaultFastTaskConfig();
  const raw = value && typeof value === "object" ? value : {};
  return {
    ...base,
    ...raw,
    enabled: raw.enabled == null ? base.enabled : Boolean(raw.enabled),
    skipIndexForSmallTasks: raw.skipIndexForSmallTasks == null ? base.skipIndexForSmallTasks : Boolean(raw.skipIndexForSmallTasks),
    preferChangedFiles: raw.preferChangedFiles == null ? base.preferChangedFiles : Boolean(raw.preferChangedFiles),
    maxIndexFiles: clampNumber(raw.maxIndexFiles, 1, 100000, base.maxIndexFiles),
    includeRoots: normalizeStringList(raw.includeRoots || raw.includePaths || base.includeRoots),
    excludePaths: normalizeStringList(raw.excludePaths || base.excludePaths)
  };
}

function normalizeAutoApproveConfig(value) {
  const base = makeDefaultAutoApproveConfig();
  const raw = value && typeof value === "object" ? value : {};
  return {
    ...base,
    ...raw,
    enabled: raw.enabled == null ? base.enabled : Boolean(raw.enabled),
    pollMs: clampNumber(raw.pollMs, 500, 10000, base.pollMs),
    warningAccepted: raw.warningAccepted == null ? base.warningAccepted : Boolean(raw.warningAccepted),
    mode: "chrome_extension"
  };
}

function normalizeStringList(value) {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value).split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function normalizeToolMode(_value) {
  return "chatgpt_local_repo";
}

function resolveWorkspace(config, alias) {
  const key = String(alias || "").trim();
  if (!key) throw new Error("workspace alias is required.");
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(key)) throw new Error(`Invalid workspace alias: ${key}`);
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
    fastTask: normalizeFastTask(entry.fastTask)
  };
}

function publicConfigSummary(config) {
  return {
    configPath: getConfigPath(),
    stateDir: config.stateDir,
    auditLogPath: config.auditLogPath,
    maxOutputBytes: config.maxOutputBytes,
    maxIndexFiles: config.maxIndexFiles,
    toolMode: normalizeToolMode(config.toolMode || "chatgpt_local_repo"),
    trustedLocalAgent: true,
    localRepoBridge: {
      mode: "trusted",
      visibleTools: BRIDGE_TOOLS,
      writeAccess: true,
      verificationAccess: true,
      resetAccess: true
    },
    removedLegacyWorkflows: ["patch", "generated scripts", "standalone shell", "task-runner", "worktree", "multi-agent", "approvals", "docker", "pr-ci-repair"],
    dashboardEnabled: Boolean(config.dashboardEnabled),
    productUx: config.productUx,
    release: config.release,
    autoApproveAppRequests: normalizeAutoApproveConfig(config.autoApproveAppRequests),
    workspaces: Object.entries(config.workspaces || {}).map(([alias, entry]) => {
      const discovered = safeDiscoverCommands(entry.path);
      return {
        alias,
        path: entry.path,
        testCommandKeys: Object.keys(entry.testCommands || {}).sort(),
        commandKeys: Object.keys(entry.commands || {}).sort(),
        protectedBranches: entry.protectedBranches || ["main", "master"],
        defaultBaseBranch: entry.defaultBaseBranch || "main",
        allowedRemotes: entry.allowedRemotes || ["origin"],
        repoSlug: entry.repoSlug || "",
        fastTask: normalizeFastTask(entry.fastTask),
        discoveredCommands: discovered,
        discoveredTestCommandKeys: Object.keys(discovered).filter((key) => /test|analy[sz]e|lint|check|vet|build/.test(key + " " + discovered[key])).sort()
      };
    }).sort((a, b) => a.alias.localeCompare(b.alias))
  };
}

function safeDiscoverCommands(workspacePath) {
  try {
    if (!workspacePath || !fs.existsSync(workspacePath)) return {};
    return discoverCommands(workspacePath);
  } catch (_error) {
    return {};
  }
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

module.exports = {
  getConfigPath,
  makeDefaultConfig,
  makeDefaultFastTaskConfig,
  normalizeFastTask,
  makeDefaultAutoApproveConfig,
  normalizeAutoApproveConfig,
  readConfig,
  writeConfig,
  normalizeConfig,
  expandHome,
  resolveWorkspace,
  publicConfigSummary
};
