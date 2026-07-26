const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { safeReadJson, realRootOf, clearRealRootCache } = require("./safety");
const { discoverCommands, staleCommandKeys } = require("./commandDiscovery");
const { readProjectInstructions, summarizeProjectInstructions } = require('./projectInstructions');

const REMOVED_WORKSPACE_COMMAND_KEYS = new Set([
  'npm:test:fast-task',
  'npm:test:oneclick',
  'npm:test:tunnel'
]);

function getConfigPath() {
  return process.env.REL_AI_MCP_CONFIG || path.join(os.homedir(), ".rel-ai-mcp", "config.json");
}

function makeDefaultContextConfig() {
  return {
    snapshotMaxFiles: 3000,
    includeRoots: [],
    excludePaths: [
      ".git", "node_modules", "build", "dist", "coverage", ".next", ".nuxt", ".svelte-kit",
      ".dart_tool", ".gradle", "target", "obj", "vendor", ".venv", "venv",
      ".claude/skills", ".superpowers", ".rel-ai-mcp-state"
    ]
  };
}

function makeDefaultPatchConfig() {
  return {
    backup: true,
    requireCleanGit: false,
    maxUpdateBytes: 2 * 1024 * 1024
  };
}

function makeDefaultConfig() {
  return {
    version: 2,
    sourceVersion: 2,
    stateDir: path.join(os.homedir(), ".rel-ai-mcp"),
    auditLogPath: "",
    maxOutputBytes: 2 * 1024 * 1024,
    toolMode: "chatgpt_local_repo",
    trustedLocalAgent: true,
    trustedBudgetMultiplier: 2,
    productUx: {
      showAutomaticValidation: true,
      staleHours: 24,
      cleanupOlderThanHours: 168,
      enableStateExport: true
    },
    release: {
      minimumReadinessScore: 80,
      requireHttpToken: true
    },
    patch: makeDefaultPatchConfig(),
    workspaces: {}
  };
}

// Every tool call reads, parses, and normalizes config.json. The file changes rarely,
// so the normalized result is cached against the file's identity — a statSync (~0.02 ms)
// replaces the read+parse+normalize. Reusing one object also lets downstream callers
// memoize per-config work by object identity.
let configCache = null;

function readConfig(options = {}) {
  const configPath = getConfigPath();
  let stat;
  try {
    // Nanosecond mtime, so two writes inside the same millisecond still invalidate.
    stat = fs.statSync(configPath, { bigint: true });
  } catch {
    configCache = null;
    if (options.allowMissing) return makeDefaultConfig();
    throw new Error(`Rel.AI MCP config not found: ${configPath}. Run: npm run init-config`);
  }
  if (configCache
    && configCache.path === configPath
    && configCache.mtimeNs === stat.mtimeNs
    && configCache.size === stat.size) {
    return configCache.config;
  }
  const parsed = safeReadJson(configPath);
  if (!parsed) throw new Error(`Config file is corrupted or empty: ${configPath}. Fix or re-run: npm run init-config`);
  const config = normalizeConfig(parsed);
  configCache = { path: configPath, mtimeNs: stat.mtimeNs, size: stat.size, config };
  return config;
}

// Drop every cached view of the config file. Callers that rewrite config.json through
// something other than writeConfig (tests, the dashboard editor) must call this so the
// next readConfig re-parses even if the filesystem timestamp did not move.
function invalidateConfigCache() {
  configCache = null;
  clearRealRootCache();
}

function writeConfig(config, options = {}) {
  const configPath = getConfigPath();
  if (options.overwrite === false && fs.existsSync(configPath)) {
    throw new Error(`Config already exists: ${configPath}`);
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const normalized = normalizeConfig(config);
  fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  invalidateConfigCache();
  return normalized;
}

function ensureConfig() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) return readConfig();
  try {
    return writeConfig(makeDefaultConfig(), { overwrite: false });
  } catch (error) {
    // Another startup path may have created the file between the existence check
    // and the guarded write. In that case, use the newly created config.
    if (fs.existsSync(configPath)) return readConfig();
    throw error;
  }
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
  normalizeProductSettings(next, base, input);
  stripLegacyApprovalKeys(next);
  next.patch = normalizePatchConfig(input.patch, input.workflow, input.flow);
  delete next.workflow;
  delete next.flow;
  delete next.cautionZone;
  const legacySnapshotMaxFiles = positiveNumber(input.maxIndexFiles, makeDefaultContextConfig().snapshotMaxFiles);
  delete next.maxIndexFiles;
  normalizeWorkspaces(next, legacySnapshotMaxFiles);
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

function normalizeProductSettings(next, base, input) {
  next.maxOutputBytes = positiveNumber(next.maxOutputBytes, base.maxOutputBytes);
  const product = { ...base.productUx, ...objectOrEmpty(input.productUx) };
  next.productUx = {
    showAutomaticValidation: normalizeBoolean(product.showAutomaticValidation, base.productUx.showAutomaticValidation),
    staleHours: clampNumber(product.staleHours, 1, 24 * 365, base.productUx.staleHours),
    cleanupOlderThanHours: clampNumber(product.cleanupOlderThanHours, 1, 24 * 365, base.productUx.cleanupOlderThanHours),
    enableStateExport: normalizeBoolean(product.enableStateExport, base.productUx.enableStateExport)
  };
  next.release = { ...base.release, ...objectOrEmpty(input.release) };
  next.release.minimumReadinessScore = clampNumber(next.release.minimumReadinessScore, 0, 100, base.release.minimumReadinessScore);
  next.release.requireHttpToken = normalizeBoolean(next.release.requireHttpToken, base.release.requireHttpToken);
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (String(value).toLowerCase() === 'true') return true;
  if (String(value).toLowerCase() === 'false') return false;
  return fallback;
}

function stripLegacyApprovalKeys(config) {
  for (const staleKey of ["auto" + "Approve", "auto" + "ApproveAppRequests", "chatgpt" + "RequestHelper"]) {
    delete config[staleKey];
  }
}

function normalizeWorkspaces(config, defaultSnapshotMaxFiles) {
  for (const [alias, workspace] of Object.entries(config.workspaces)) {
    config.workspaces[alias] = normalizeWorkspace(workspace || {}, defaultSnapshotMaxFiles);
  }
}

function normalizeWorkspace(workspace, defaultSnapshotMaxFiles) {
  return {
    path: workspace.path,
    testCommands: normalizeWorkspaceCommandMap(workspace.testCommands),
    commands: normalizeWorkspaceCommandMap(workspace.commands),
    protectedBranches: workspace.protectedBranches || ["main", "master"],
    defaultBaseBranch: workspace.defaultBaseBranch || "main",
    allowedRemotes: Array.isArray(workspace.allowedRemotes) ? workspace.allowedRemotes : ["origin"],
    repoSlug: workspace.repoSlug || "",
    context: normalizeContextConfig(workspace.context || workspace.fastTask, defaultSnapshotMaxFiles),
    validationRules: workspace.validationRules && typeof workspace.validationRules === "object" ? workspace.validationRules : {}
  };
}

function normalizeWorkspaceCommandMap(value) {
  const source = objectOrEmpty(value);
  return Object.fromEntries(Object.entries(source).filter(([key]) => !REMOVED_WORKSPACE_COMMAND_KEYS.has(key)));
}

function normalizeContextConfig(value, defaultSnapshotMaxFiles) {
  const base = {
    ...makeDefaultContextConfig(),
    ...(defaultSnapshotMaxFiles ? { snapshotMaxFiles: defaultSnapshotMaxFiles } : {})
  };
  const raw = value && typeof value === "object" ? value : {};
  const snapshotMaxFiles = raw.snapshotMaxFiles == null ? raw.maxIndexFiles : raw.snapshotMaxFiles;
  return {
    ...base,
    snapshotMaxFiles: clampNumber(snapshotMaxFiles, 1, 100000, base.snapshotMaxFiles),
    includeRoots: normalizeStringList(raw.includeRoots || raw.includePaths || base.includeRoots),
    excludePaths: normalizeStringList(raw.excludePaths || base.excludePaths)
  };
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizePatchConfig(value, legacyWorkflow, legacyFlow) {
  const base = makeDefaultPatchConfig();
  const current = objectOrEmpty(value);
  const workflow = objectOrEmpty(legacyWorkflow);
  const flow = objectOrEmpty(legacyFlow);
  const legacyPrepared = objectOrEmpty(workflow.prepared);
  const legacyAggressive = objectOrEmpty(workflow.aggressive);
  const legacyFast = objectOrEmpty(flow.fast);
  const merged = {
    ...base,
    ...legacyFast,
    ...legacyAggressive,
    ...legacyPrepared,
    ...current
  };
  const maxUpdateBytes = current.maxUpdateBytes ?? current.maxPatchBytes
    ?? legacyPrepared.maxUpdateBytes ?? legacyPrepared.maxPatchBytes
    ?? legacyAggressive.maxUpdateBytes ?? legacyAggressive.maxPatchBytes
    ?? legacyFast.maxUpdateBytes ?? legacyFast.maxPatchBytes
    ?? base.maxUpdateBytes;
  return {
    backup: merged.backup == null ? base.backup : Boolean(merged.backup),
    requireCleanGit: merged.requireCleanGit == null ? base.requireCleanGit : Boolean(merged.requireCleanGit),
    maxUpdateBytes: clampNumber(maxUpdateBytes, 1024, 50 * 1024 * 1024, base.maxUpdateBytes)
  };
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

function workspaceResolutionError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.source = 'rel-ai-mcp-workspace';
  error.operation = 'workspace_resolution';
  error.retryable = false;
  error.requiresUserConfirmation = false;
  error.workspaceInput = details.workspaceInput == null ? '' : String(details.workspaceInput);
  error.workspaceInputSource = String(details.workspaceInputSource || 'tool_argument');
  error.workspaceMatchStatus = String(details.workspaceMatchStatus || 'unmatched');
  error.workspaceResolutionFailure = String(details.workspaceResolutionFailure || code.toLowerCase());
  error.configuredWorkspaceAliases = Array.isArray(details.configuredWorkspaceAliases)
    ? details.configuredWorkspaceAliases.map(String).slice(0, 100)
    : [];
  error.allowedAlternatives = error.configuredWorkspaceAliases.length
    ? [`Use one configured workspace alias: ${error.configuredWorkspaceAliases.join(', ')}.`]
    : ['Configure a workspace before starting a task.'];
  return error;
}

function resolveWorkspaceInput(config, input) {
  const aliases = Object.keys(config.workspaces || {}).sort((left, right) => left.localeCompare(right));
  const omitted = input == null || String(input).trim() === '';
  const key = String(input || '').trim();
  if (omitted) return { input: '', alias: '', source: 'omitted', aliases };
  if (Object.hasOwn(config.workspaces || {}, key)) return { input: key, alias: key, source: 'alias', aliases };
  if (!isAbsoluteWorkspaceInput(key)) return { input: key, alias: '', source: 'unmatched_alias', aliases };

  const inputCanonical = canonicalWorkspacePath(key);
  if (!inputCanonical) return { input: key, alias: '', source: 'path_unavailable', aliases };
  const matches = [];
  for (const alias of aliases) {
    const configuredCanonical = canonicalWorkspacePath(config.workspaces?.[alias]?.path);
    if (configuredCanonical && configuredCanonical === inputCanonical) matches.push(alias);
  }
  if (matches.length > 1) {
    throw workspaceResolutionError('WORKSPACE_PATH_AMBIGUOUS', 'The supplied workspace path matches more than one configured workspace.', {
      workspaceInput: key,
      workspaceInputSource: 'configured_path',
      workspaceMatchStatus: 'ambiguous_configured_path_match',
      workspaceResolutionFailure: 'multiple_configured_workspaces_share_canonical_path',
      configuredWorkspaceAliases: matches
    });
  }
  return {
    input: key,
    alias: matches[0] || '',
    source: matches.length === 1 ? 'configured_path' : 'unmatched_path',
    aliases,
    canonicalPath: inputCanonical
  };
}

function isAbsoluteWorkspaceInput(value) {
  const text = String(value || '').trim();
  return path.isAbsolute(text) || path.win32.isAbsolute(text);
}

function canonicalWorkspacePath(value) {
  const text = String(value || '').trim();
  if (!text || !isAbsoluteWorkspaceInput(text)) return '';
  try {
    const resolved = fs.realpathSync.native ? fs.realpathSync.native(text) : fs.realpathSync(text);
    return normalizeWorkspacePathForComparison(resolved);
  } catch {
    return '';
  }
}

function normalizeWorkspacePathForComparison(value, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path;
  let normalized = pathApi.normalize(String(value || ''));
  const rootLength = pathApi.parse(normalized).root.length;
  while (normalized.length > rootLength && /[\\/]$/.test(normalized)) normalized = normalized.slice(0, -1);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function resolveWorkspace(config, alias) {
  const resolution = resolveWorkspaceInput(config, alias);
  const aliases = resolution.aliases;
  const omitted = resolution.source === 'omitted';
  const key = resolution.input;
  if (omitted) {
    throw workspaceResolutionError('WORKSPACE_INPUT_OMITTED', 'A configured workspace alias is required; the workspace argument was omitted.', {
      workspaceInput: '',
      workspaceMatchStatus: 'not_attempted',
      workspaceResolutionFailure: 'workspace_argument_omitted',
      configuredWorkspaceAliases: aliases
    });
  }
  if (key === '.') {
    throw workspaceResolutionError('WORKSPACE_AMBIGUOUS_RELATIVE_INPUT', "Workspace '.' is ambiguous and is not resolved against the server process directory. Pass a configured workspace alias.", {
      workspaceInput: key,
      workspaceMatchStatus: 'rejected_ambiguous_input',
      workspaceResolutionFailure: 'explicit_dot_has_no_authoritative_client_base',
      configuredWorkspaceAliases: aliases
    });
  }
  if (resolution.source === 'path_unavailable') {
    throw workspaceResolutionError('WORKSPACE_PATH_UNAVAILABLE', 'The supplied absolute workspace path does not exist or cannot be resolved.', {
      workspaceInput: key,
      workspaceInputSource: 'configured_path',
      workspaceMatchStatus: 'path_unavailable',
      workspaceResolutionFailure: 'workspace_path_missing_or_unreadable',
      configuredWorkspaceAliases: aliases
    });
  }
  if (resolution.source === 'unmatched_path') {
    throw workspaceResolutionError('WORKSPACE_PATH_NOT_CONFIGURED', 'The supplied path does not exactly match any configured workspace.', {
      workspaceInput: key,
      workspaceInputSource: 'configured_path',
      workspaceMatchStatus: 'no_configured_path_match',
      workspaceResolutionFailure: 'canonical_path_not_configured',
      configuredWorkspaceAliases: aliases
    });
  }
  if (resolution.source === 'unmatched_alias' && !isSafeWorkspaceAlias(key)) {
    throw workspaceResolutionError('WORKSPACE_ALIAS_INVALID', `Invalid workspace alias: ${key}`, {
      workspaceInput: key,
      workspaceMatchStatus: 'invalid_alias',
      workspaceResolutionFailure: 'workspace_alias_syntax_invalid',
      configuredWorkspaceAliases: aliases
    });
  }
  const resolvedAlias = resolution.alias || key;
  const entry = config.workspaces?.[resolvedAlias];
  if (!entry) {
    throw workspaceResolutionError('WORKSPACE_NOT_CONFIGURED', `Workspace '${key}' is not configured.`, {
      workspaceInput: key,
      workspaceMatchStatus: 'no_configured_alias_match',
      workspaceResolutionFailure: 'workspace_alias_not_configured',
      configuredWorkspaceAliases: aliases
    });
  }
  assertSafeWorkspaceRoot(entry.path, `Workspace '${resolvedAlias}' path`);
  if (!fs.existsSync(entry.path)) throw new Error(`Workspace '${resolvedAlias}' path does not exist: ${entry.path}`);
  const realRoot = realRootOf(entry.path);
  assertSafeWorkspaceRoot(realRoot, `Workspace '${resolvedAlias}' resolved path`);
  return {
    alias: resolvedAlias,
    path: realRoot,
    testCommands: entry.testCommands || {},
    commands: entry.commands || {},
    protectedBranches: entry.protectedBranches || ["main", "master"],
    defaultBaseBranch: entry.defaultBaseBranch || "main",
    allowedRemotes: entry.allowedRemotes || ["origin"],
    repoSlug: entry.repoSlug || "",
    context: normalizeContextConfig(entry.context || entry.fastTask),
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
    toolMode: "chatgpt_local_repo",
    trustedLocalAgent: true,
    patch: normalizePatchConfig(config.patch),
    localRepoBridge: {
      mode: "trusted",
      visibleTools: require("./tools").TOOL_NAMES,
      writeAccess: true,
      verificationAccess: true,
      restoreAccess: true
    },
    productUx: config.productUx,
    release: config.release,
    workspaces: Object.entries(config.workspaces || {}).map(([alias, entry]) => {
      const discovered = safeDiscoverCommands(entry.path);
      const validationCommands = safeDetectValidationChecks(entry.path);
      const projectInstructions = summarizeProjectInstructions(readProjectInstructions({ alias, path: entry.path }));
      return {
        alias,
        path: entry.path,
        testCommandKeys: Object.keys(entry.testCommands || {}).sort((a, b) => a.localeCompare(b)),
        commandKeys: Object.keys(entry.commands || {}).sort((a, b) => a.localeCompare(b)),
        protectedBranches: entry.protectedBranches || ["main", "master"],
        defaultBaseBranch: entry.defaultBaseBranch || "main",
        allowedRemotes: entry.allowedRemotes || ["origin"],
        repoSlug: entry.repoSlug || "",
        context: normalizeContextConfig(entry.context || entry.fastTask),
        discoveredCommands: discovered,
        validationCommands,
        projectInstructions,
        discoveredTestCommandKeys: Object.keys(discovered).filter((key) => /test|analy[sz]e|lint|check|vet|build/.test(key + " " + discovered[key])).sort((a, b) => a.localeCompare(b)),
        staleCommandKeys: staleCommandKeys(entry.commands || {}, discovered).sort((a, b) => a.localeCompare(b)),
        staleTestCommandKeys: staleCommandKeys(entry.testCommands || {}, discovered).sort((a, b) => a.localeCompare(b))
      };
    }).sort((a, b) => a.alias.localeCompare(b.alias))
  };
}

// publicConfigSummary runs on every dashboard poll and calls these per workspace.
// Both discoverCommands and detectVerifyChecks now cache against a stat signature of
// every manifest they understand, so these wrappers only add the missing-path guard
// and keep a discovery failure from breaking the whole summary.
function safeDiscoverCommands(workspacePath) {
  try {
    if (!workspacePath || !fs.existsSync(workspacePath)) return {};
    return discoverCommands(workspacePath);
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] discover commands:', error);
    return {};
  }
}

function safeDetectValidationChecks(workspacePath) {
  try {
    if (!workspacePath || !fs.existsSync(workspacePath)) return [];
    return require('./bridge/validation').detectVerifyChecks(workspacePath, 'standard');
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] detect validation checks:', error);
    return [];
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
  makeDefaultContextConfig,
  normalizeContextConfig,
  makeDefaultPatchConfig,
  normalizePatchConfig,
  readConfig,
  invalidateConfigCache,
  ensureConfig,
  writeConfig,
  normalizeConfig,
  expandHome,
  assertSafeWorkspaceRoot,
  resolveWorkspaceInput,
  normalizeWorkspacePathForComparison,
  resolveWorkspace,
  publicConfigSummary
};
