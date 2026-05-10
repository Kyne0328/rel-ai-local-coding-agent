const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { safeReadJson } = require("./safety");
const { discoverCommands } = require("./commandDiscovery");

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
    version: 1,
    stateDir: path.join(os.homedir(), ".rel-ai-mcp"),
    auditLogPath: "",
    maxOutputBytes: 2 * 1024 * 1024,
    maxSessionSteps: 1000,
    maxPlanSteps: 200,
    maxIndexFiles: 25000,
    maxConcurrentSessionsPerWorkspace: 4,
    sessionLocksEnabled: true,
    worktreeRoot: path.join(os.homedir(), ".rel-ai-mcp", "worktrees"),
    toolMode: "chatgpt_local_repo",
    trustedLocalAgent: true,
    allowGitHubCli: false,
    allowDocker: false,
    allowArbitraryCommands: true,
    allowDestructiveTools: true,
    agentMode: true,
    permissionProfile: "admin",
    approvalGates: {
      commit: false,
      push: true,
      pr: true,
      reset: true,
      "worktree-remove": true,
      docker: false,
      command: false,
      patch: false,
      write: false,
      merge: true
    },
    dashboardEnabled: true,
    defaultTaskMode: "implement_and_test",
    taskRunner: {
      maxCycles: 3,
      requireWorktree: true,
      requireApprovalBeforeCommit: true,
      requireApprovalBeforePush: true,
      requireApprovalBeforePr: true
    },
    ciRepair: {
      enabled: false,
      maxCycles: 3,
      watchAttempts: 5,
      intervalSeconds: 15,
      requireApprovalBeforePush: true
    },
    sandboxMode: "none",
    multiAgent: {
      enabled: false,
      maxSubtasks: 1,
      maxParallelSubtasks: 1,
      requireReviewBeforeMerge: false,
      defaultRoles: []
    },
    scheduler: {
      enabled: false,
      maxRetries: 1,
      stopOnFailure: true
    },
    memory: {
      enabled: true,
      maxNotesPerWorkspace: 500,
      maxNoteChars: 20000
    },
    semanticIndex: {
      enabled: false,
      maxFiles: 8000,
      maxFileBytes: 200000
    },
    policies: {
      blockedPaths: [],
      maxPatchFiles: 50,
      requireApprovalBeforePush: true,
      requireApprovalBeforeMergeBack: true
    },
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
      requireCleanWorktreeBeforePush: true,
      connectorProbeTimeoutMs: 5000,
      enableReleaseEndpoints: true
    },
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
  next.toolMode = "chatgpt_local_repo";
  next.trustedLocalAgent = true;
  next.permissionProfile = "admin";

  for (const key of ["maxOutputBytes", "maxSessionSteps", "maxPlanSteps", "maxIndexFiles", "maxConcurrentSessionsPerWorkspace"]) {
    if (!Number.isFinite(next[key]) || next[key] <= 0) next[key] = base[key];
  }
  next.allowGitHubCli = Boolean(next.allowGitHubCli);
  next.allowDocker = Boolean(next.allowDocker);
  next.allowArbitraryCommands = true;
  next.allowDestructiveTools = true;
  next.agentMode = true;
  next.sessionLocksEnabled = next.sessionLocksEnabled !== false;
  next.dashboardEnabled = next.dashboardEnabled !== false;
  next.defaultTaskMode = String(next.defaultTaskMode || base.defaultTaskMode);
  next.sandboxMode = ["none", "docker", "docker_readonly_base"].includes(String(next.sandboxMode)) ? String(next.sandboxMode) : "none";
  next.multiAgent = { ...base.multiAgent, ...((config && config.multiAgent) || {}) };
  next.multiAgent.enabled = false;
  next.multiAgent.maxSubtasks = Math.min(Math.max(Number(next.multiAgent.maxSubtasks || base.multiAgent.maxSubtasks), 1), 50);
  next.multiAgent.maxParallelSubtasks = Math.min(Math.max(Number(next.multiAgent.maxParallelSubtasks || base.multiAgent.maxParallelSubtasks), 1), 20);
  next.multiAgent.defaultRoles = Array.isArray(next.multiAgent.defaultRoles) ? next.multiAgent.defaultRoles.map(String).slice(0, 20) : base.multiAgent.defaultRoles;
  next.taskRunner = { ...base.taskRunner, ...((config && config.taskRunner) || {}) };
  next.ciRepair = { ...base.ciRepair, ...((config && config.ciRepair) || {}) };
  next.scheduler = { ...base.scheduler, ...((config && config.scheduler) || {}) };
  next.memory = { ...base.memory, ...((config && config.memory) || {}) };
  next.semanticIndex = { ...base.semanticIndex, ...((config && config.semanticIndex) || {}) };
  next.policies = { ...base.policies, ...((config && config.policies) || {}) };
  next.productUx = { ...base.productUx, ...((config && config.productUx) || {}) };
  next.release = { ...base.release, ...((config && config.release) || {}) };
  next.release.minimumReadinessScore = Math.min(Math.max(Number(next.release.minimumReadinessScore || base.release.minimumReadinessScore), 0), 100);
  next.release.connectorProbeTimeoutMs = Math.min(Math.max(Number(next.release.connectorProbeTimeoutMs || base.release.connectorProbeTimeoutMs), 500), 60000);
  next.approvalGates = { ...base.approvalGates, ...((config && config.approvalGates) || {}) };
  next.allowArbitraryCommands = true;
  next.allowDestructiveTools = true;
  next.permissionProfile = "admin";
  next.agentMode = true;
  next.approvalGates = Object.fromEntries(Object.keys(next.approvalGates).map((k) => [k, false]));
  next.taskRunner = {
    ...next.taskRunner,
    requireApprovalBeforeCommit: false,
    requireApprovalBeforePush: false,
    requireApprovalBeforePr: false
  };

  for (const [alias, workspace] of Object.entries(next.workspaces)) {
    next.workspaces[alias] = normalizeWorkspace(workspace || {});
  }
  return next;
}

function normalizeWorkspace(workspace) {
  const fastTask = normalizeFastTask(workspace.fastTask);
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
    allowDestructiveTools: Boolean(workspace.allowDestructiveTools),
    fastTask
  };
}

function normalizeFastTask(value) {
  const base = makeDefaultFastTaskConfig();
  const raw = value && typeof value === "object" ? value : {};
  const maxIndexFiles = Number(raw.maxIndexFiles);
  return {
    ...base,
    ...raw,
    enabled: raw.enabled == null ? base.enabled : Boolean(raw.enabled),
    skipIndexForSmallTasks: raw.skipIndexForSmallTasks == null ? base.skipIndexForSmallTasks : Boolean(raw.skipIndexForSmallTasks),
    preferChangedFiles: raw.preferChangedFiles == null ? base.preferChangedFiles : Boolean(raw.preferChangedFiles),
    maxIndexFiles: Number.isFinite(maxIndexFiles) && maxIndexFiles > 0 ? Math.min(Math.floor(maxIndexFiles), 100000) : base.maxIndexFiles,
    includeRoots: normalizeStringList(raw.includeRoots || raw.includePaths || base.includeRoots),
    excludePaths: normalizeStringList(raw.excludePaths || base.excludePaths)
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
    allowDestructiveTools: Boolean(entry.allowDestructiveTools || config.allowDestructiveTools),
    fastTask: normalizeFastTask(entry.fastTask)
  };
}

function publicConfigSummary(config) {
  return {
    configPath: getConfigPath(),
    stateDir: config.stateDir,
    auditLogPath: config.auditLogPath,
    maxOutputBytes: config.maxOutputBytes,
    maxSessionSteps: config.maxSessionSteps,
    maxPlanSteps: config.maxPlanSteps,
    maxIndexFiles: config.maxIndexFiles,
    maxConcurrentSessionsPerWorkspace: config.maxConcurrentSessionsPerWorkspace,
    sessionLocksEnabled: Boolean(config.sessionLocksEnabled),
    worktreeRoot: config.worktreeRoot,
    permissionProfile: config.permissionProfile,
    allowGitHubCli: Boolean(config.allowGitHubCli),
    allowDocker: Boolean(config.allowDocker),
    allowArbitraryCommands: Boolean(config.allowArbitraryCommands),
    allowDestructiveTools: Boolean(config.allowDestructiveTools),
    agentMode: Boolean(config.agentMode),
    toolMode: normalizeToolMode(config.toolMode || "chatgpt_local_repo"),
    trustedLocalAgent: true,
    localRepoBridge: {
      mode: "trusted",
      visibleTools: ["relai_repo_snapshot", "relai_read", "relai_write", "relai_shell", "relai_verify", "relai_browser", "relai_diff", "relai_reset"],
      shellAccess: true,
      writeAccess: true,
      approvalGatesBypassed: true
    },
    approvalGates: config.approvalGates,
    dashboardEnabled: Boolean(config.dashboardEnabled),
    defaultTaskMode: config.defaultTaskMode,
    taskRunner: config.taskRunner,
    ciRepair: config.ciRepair,
    sandboxMode: config.sandboxMode,
    multiAgent: config.multiAgent,
    scheduler: config.scheduler,
    memory: config.memory,
    semanticIndex: config.semanticIndex,
    policies: config.policies,
    productUx: config.productUx,
    release: config.release,
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
      allowDestructiveTools: Boolean(entry.allowDestructiveTools),
      fastTask: normalizeFastTask(entry.fastTask),
      discoveredCommands: safeDiscoverCommands(entry.path),
      discoveredTestCommandKeys: Object.keys(safeDiscoverCommands(entry.path)).filter((key) => /test|analy[sz]e|lint|check|vet|build/.test(key + " " + safeDiscoverCommands(entry.path)[key])).sort()
    })).sort((a, b) => a.alias.localeCompare(b.alias))
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

module.exports = {
  getConfigPath,
  makeDefaultConfig,
  makeDefaultFastTaskConfig,
  readConfig,
  writeConfig,
  normalizeConfig,
  expandHome,
  resolveWorkspace,
  publicConfigSummary
};
