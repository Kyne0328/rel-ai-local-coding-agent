const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { safeReadJson } = require("./safety");
const { discoverCommands, staleCommandKeys } = require("./commandDiscovery");

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
      ".dart_tool", ".gradle", "target", "obj", "vendor", ".venv", "venv",
      ".claude/skills", ".superpowers"
    ]
  };
}

function makeDefaultWorkflowConfig() {
  return {
    mode: "standard",
    prepared: {
      backup: true,
      requireCleanGit: false,
      clearMissingDefault: false,
      maxUpdateBytes: 2 * 1024 * 1024,
      maxBundleBytes: 250 * 1024 * 1024
    }
  };
}

function makeDefaultConfig() {
  return {
    version: 2,
    sourceVersion: 2,
    stateDir: path.join(os.homedir(), ".rel-ai-mcp"),
    auditLogPath: "",
    maxOutputBytes: 2 * 1024 * 1024,
    maxIndexFiles: 3000,
    toolMode: "chatgpt_local_repo",
    trustedLocalAgent: true,
    trustedBudgetMultiplier: 2,
    cautionZone: { massClearThreshold: 3, bundleFileThreshold: 5, bundleBytesThreshold: 102400 },
    productUx: {
      dashboardRefreshSeconds: 5,
      liveLogPollSeconds: 3,
      staleHours: 24,
      cleanupOlderThanHours: 168,
      enableStateExport: true
    },
    release: {
      minimumReadinessScore: 80,
      requireHttpToken: true
    },
    workflow: makeDefaultWorkflowConfig(),
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
  const next = mergeConfigBase(base, input);
  normalizeCorePaths(next, base, input);
  normalizeTrustedMode(next, input);
  normalizeCautionZone(next, base, input);
  normalizeProductSettings(next, base, input);
  stripLegacyApprovalKeys(next);
  next.workflow = normalizeWorkflowConfig(input.workflow, input.flow);
  normalizeWorkspaces(next);
  return next;
}

function mergeConfigBase(base, input) {
  return { ...base, ...input, workspaces: { ...objectOrEmpty(input.workspaces) } };
}

function normalizeCorePaths(next, base, input) {
  next.sourceVersion = Number.isFinite(Number(input.version)) ? Number(input.version) : base.sourceVersion;
  next.version = 2;
  next.stateDir = expandHome(next.stateDir || base.stateDir);
  if (!path.isAbsolute(next.stateDir)) next.stateDir = path.resolve(next.stateDir);
  next.auditLogPath = next.auditLogPath ? expandHome(next.auditLogPath) : path.join(next.stateDir, "audit.jsonl");
  if (!path.isAbsolute(next.auditLogPath)) next.auditLogPath = path.resolve(next.auditLogPath);
}

function normalizeTrustedMode(next, input) {
  next.toolMode = "chatgpt_local_repo";
  next.trustedLocalAgent = true;
  next.trustedBudgetMultiplier = normalizeTrustedBudgetMultiplier(input.trustedBudgetMultiplier);
}

function normalizeTrustedBudgetMultiplier(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1 || number > 10) return 2;
  return Math.floor(number);
}

function normalizeCautionZone(next, base, input) {
  const raw = objectOrEmpty(input.cautionZone);
  const cautionBase = base.cautionZone;
  next.cautionZone = {
    massClearThreshold: positiveNumber(raw.massClearThreshold, cautionBase.massClearThreshold),
    bundleFileThreshold: positiveNumber(raw.bundleFileThreshold, cautionBase.bundleFileThreshold),
    bundleBytesThreshold: positiveNumber(raw.bundleBytesThreshold, cautionBase.bundleBytesThreshold)
  };
}

function normalizeProductSettings(next, base, input) {
  next.maxOutputBytes = positiveNumber(next.maxOutputBytes, base.maxOutputBytes);
  next.maxIndexFiles = positiveNumber(next.maxIndexFiles, base.maxIndexFiles);
  next.productUx = { ...base.productUx, ...input.productUx };
  next.release = { ...base.release, ...input.release };
  next.release.minimumReadinessScore = clampNumber(next.release.minimumReadinessScore, 0, 100, base.release.minimumReadinessScore);
  next.release.requireHttpToken = next.release.requireHttpToken !== false;
}

function stripLegacyApprovalKeys(config) {
  for (const staleKey of ["auto" + "Approve", "auto" + "ApproveAppRequests", "chatgpt" + "RequestHelper"]) {
    delete config[staleKey];
  }
}

function normalizeWorkspaces(config) {
  for (const [alias, workspace] of Object.entries(config.workspaces)) {
    config.workspaces[alias] = normalizeWorkspace(workspace || {});
  }
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
    fastTask: normalizeFastTask(workspace.fastTask),
    validationRules: workspace.validationRules && typeof workspace.validationRules === "object" ? workspace.validationRules : {}
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

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function _pickPreparedValue(sources, fieldNames, transform, fallback) {
  for (const source of sources) {
    for (const name of fieldNames) {
      const val = source[name];
      if (val != null) return transform ? transform(val) : val;
    }
  }
  return fallback;
}

function workflowMode(raw, flow) {
  if (raw.mode === "prepared" || raw.mode === "aggressive") return "prepared";
  if (raw.mode === "standard" || raw.mode === "conservative") return "standard";
  return !raw.mode && flow.mode === "fast" ? "prepared" : "standard";
}

function preparedSources(raw, flow) {
  return {
    oldAggressive: objectOrEmpty(raw.aggressive),
    oldFlow: objectOrEmpty(flow.fast),
    rawPrepared: objectOrEmpty(raw.prepared)
  };
}

function normalizeWorkflowConfig(value, flowLegacy) {
  const base = makeDefaultWorkflowConfig();
  const raw = objectOrEmpty(value);
  const flow = objectOrEmpty(flowLegacy);
  const { oldAggressive, oldFlow, rawPrepared } = preparedSources(raw, flow);
  const sources = [rawPrepared, oldAggressive, oldFlow];
  const merged = { ...base.prepared, ...oldFlow, ...oldAggressive, ...rawPrepared };
  return {
    mode: workflowMode(raw, flow),
    prepared: {
      backup: merged.backup == null ? base.prepared.backup : Boolean(merged.backup),
      requireCleanGit: merged.requireCleanGit == null ? base.prepared.requireCleanGit : Boolean(merged.requireCleanGit),
      clearMissingDefault: _pickPreparedValue(sources, ["clearMissingDefault", "deleteMissingDefault"], Boolean, base.prepared.clearMissingDefault),
      maxUpdateBytes: _pickPreparedValue(sources, ["maxUpdateBytes", "maxPatchBytes"], (v) => clampNumber(v, 1024, 50 * 1024 * 1024, base.prepared.maxUpdateBytes), base.prepared.maxUpdateBytes),
      maxBundleBytes: _pickPreparedValue(sources, ["maxBundleBytes", "maxArchiveBytes"], (v) => clampNumber(v, 1024 * 1024, 2 * 1024 * 1024 * 1024, base.prepared.maxBundleBytes), base.prepared.maxBundleBytes)
    }
  };
}

function getWorkflowConfig(config) {
  return config.workflow || makeDefaultWorkflowConfig();
}

function isPreparedWorkflow(config) {
  return getWorkflowConfig(config).mode === "prepared";
}

function normalizeStringList(value) {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value).split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function assertSafeWorkspaceRoot(rawPath, label = "Workspace path") {
  const text = String(rawPath || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  if (!path.isAbsolute(text)) throw new Error(`${label} must be absolute.`);
  const resolved = path.resolve(text);
  const strip = (value) => {
    let text = String(value || "");
    while (text.endsWith("/") || text.endsWith("\\")) text = text.slice(0, -1);
    return text || String(value || "");
  };
  const parsed = path.parse(resolved);
  const root = strip(parsed.root);
  const normalized = strip(resolved).toLowerCase();
  const unsafe = new Set([root.toLowerCase()]);

  for (const item of ["Windows", "Program Files", "Program Files (x86)", "Users", "etc", "usr", "bin", "sbin", "var", "tmp", "home", "System", "Library", "Applications"]) {
    unsafe.add(strip(path.join(parsed.root, item)).toLowerCase());
  }

  if (unsafe.has(normalized)) {
    throw new Error(`Unsafe workspace path refused: ${resolved}. Choose a project directory, not a system root.`);
  }
  return resolved;
}

function resolveWorkspace(config, alias) {
  const key = String(alias || "").trim();
  if (!key) throw new Error("workspace alias is required.");
  if (!isSafeWorkspaceAlias(key)) throw new Error(`Invalid workspace alias: ${key}`);
  const entry = config.workspaces?.[key];
  if (!entry) throw new Error(`Workspace '${key}' is not configured.`);
  assertSafeWorkspaceRoot(entry.path, `Workspace '${key}' path`);
  if (!fs.existsSync(entry.path)) throw new Error(`Workspace '${key}' path does not exist: ${entry.path}`);
  const realRoot = fs.realpathSync(entry.path);
  assertSafeWorkspaceRoot(realRoot, `Workspace '${key}' resolved path`);
  return {
    alias: key,
    path: realRoot,
    testCommands: entry.testCommands || {},
    commands: entry.commands || {},
    protectedBranches: entry.protectedBranches || ["main", "master"],
    defaultBaseBranch: entry.defaultBaseBranch || "main",
    allowedRemotes: entry.allowedRemotes || ["origin"],
    repoSlug: entry.repoSlug || "",
    fastTask: normalizeFastTask(entry.fastTask),
    validationRules: entry.validationRules && typeof entry.validationRules === "object" ? entry.validationRules : {}
  };
}

function isSafeWorkspaceAlias(value) {
  if (!value || value.length > 80) return false;
  for (const ch of value) {
    const code = ch.codePointAt(0);
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    if (!isUpper && !isLower && !isDigit && ch !== '.' && ch !== '_' && ch !== '-') return false;
  }
  return true;
}

function publicConfigSummary(config) {
  return {
    configPath: getConfigPath(),
    stateDir: config.stateDir,
    auditLogPath: config.auditLogPath,
    maxOutputBytes: config.maxOutputBytes,
    maxIndexFiles: config.maxIndexFiles,
    toolMode: "chatgpt_local_repo",
    trustedLocalAgent: true,
    workflow: normalizeWorkflowConfig(config.workflow),
    localRepoBridge: {
      mode: "trusted",
      visibleTools: require("./tools").PUBLIC_HTTP_TOOL_NAMES,
      writeAccess: true,
      verificationAccess: true,
      restoreAccess: true
    },
    removedLegacyWorkflows: ["generated helper scripts", "standalone shell fallback loops", "task-runner", "multi-agent", "approval-gates", "docker", "pr-ci-repair"],
    productUx: config.productUx,
    release: config.release,
    workspaces: Object.entries(config.workspaces || {}).map(([alias, entry]) => {
      const discovered = safeDiscoverCommands(entry.path);
      return {
        alias,
        path: entry.path,
        testCommandKeys: Object.keys(entry.testCommands || {}).sort((a, b) => a.localeCompare(b)),
        commandKeys: Object.keys(entry.commands || {}).sort((a, b) => a.localeCompare(b)),
        protectedBranches: entry.protectedBranches || ["main", "master"],
        defaultBaseBranch: entry.defaultBaseBranch || "main",
        allowedRemotes: entry.allowedRemotes || ["origin"],
        repoSlug: entry.repoSlug || "",
        fastTask: normalizeFastTask(entry.fastTask),
        discoveredCommands: discovered,
        discoveredTestCommandKeys: Object.keys(discovered).filter((key) => /test|analy[sz]e|lint|check|vet|build/.test(key + " " + discovered[key])).sort((a, b) => a.localeCompare(b)),
        staleTestCommandKeys: staleCommandKeys(entry.testCommands || {}, discovered).sort((a, b) => a.localeCompare(b))
      };
    }).sort((a, b) => a.alias.localeCompare(b.alias))
  };
}

// publicConfigSummary runs on every dashboard poll and calls this per workspace;
// each call walks manifest files on disk. Cache keyed on the workspace's
// package.json mtime so discovery only re-runs when the manifest actually changes.
const _discoverCache = new Map();
function safeDiscoverCommands(workspacePath) {
  try {
    if (!workspacePath || !fs.existsSync(workspacePath)) return {};
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(path.join(workspacePath, "package.json")).mtimeMs; } catch (error) { if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] package.json stat:', error); }
    const cached = _discoverCache.get(workspacePath);
    if (cached?.mtimeMs === mtimeMs) return cached.value;
    const value = discoverCommands(workspacePath);
    _discoverCache.set(workspacePath, { mtimeMs, value });
    return value;
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] discover commands:', error);
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
  makeDefaultWorkflowConfig,
  normalizeWorkflowConfig,
  getWorkflowConfig,
  isPreparedWorkflow,
  readConfig,
  writeConfig,
  normalizeConfig,
  expandHome,
  assertSafeWorkspaceRoot,
  resolveWorkspace,
  publicConfigSummary
};
