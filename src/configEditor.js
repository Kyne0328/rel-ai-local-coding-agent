const fs = require("node:fs");
const path = require("node:path");
const { getConfigPath, publicConfigSummary, writeConfig } = require("./config");

const DANGEROUS_KEYS = new Set([
  "allowArbitraryCommands",
  "allowDestructiveTools",
  "allowDocker",
  "allowGitHubCli"
]);

const BOOLEAN_KEYS = [
  "allowGitHubCli",
  "allowDocker",
  "allowArbitraryCommands",
  "allowDestructiveTools",
  "sessionLocksEnabled",
  "dashboardEnabled"
];

const NUMBER_KEYS = [
  "maxOutputBytes",
  "maxSessionSteps",
  "maxPlanSteps",
  "maxIndexFiles",
  "maxConcurrentSessionsPerWorkspace"
];

const NESTED_SCHEMA = {
  approvalGates: "booleanMap",
  taskRunner: {
    maxCycles: "number",
    requireWorktree: "boolean",
    requireApprovalBeforeCommit: "boolean",
    requireApprovalBeforePush: "boolean",
    requireApprovalBeforePr: "boolean"
  },
  ciRepair: {
    enabled: "boolean",
    maxCycles: "number",
    watchAttempts: "number",
    intervalSeconds: "number",
    requireApprovalBeforePush: "boolean"
  },
  multiAgent: {
    enabled: "boolean",
    maxSubtasks: "number",
    maxParallelSubtasks: "number",
    requireReviewBeforeMerge: "boolean",
    defaultRoles: "stringList"
  },
  scheduler: {
    enabled: "boolean",
    maxRetries: "number",
    stopOnFailure: "boolean"
  },
  memory: {
    enabled: "boolean",
    maxNotesPerWorkspace: "number",
    maxNoteChars: "number"
  },
  semanticIndex: {
    enabled: "boolean",
    maxFiles: "number",
    maxFileBytes: "number"
  },
  policies: {
    maxPatchFiles: "number",
    requireApprovalBeforePush: "boolean",
    requireApprovalBeforeMergeBack: "boolean",
    blockedPaths: "stringList"
  },
  productUx: {
    dashboardRefreshSeconds: "number",
    liveLogPollSeconds: "number",
    staleHours: "number",
    cleanupOlderThanHours: "number",
    enableStateExport: "boolean"
  },
  release: {
    minimumReadinessScore: "number",
    requireHttpToken: "boolean",
    requireCleanWorktreeBeforePush: "boolean",
    connectorProbeTimeoutMs: "number",
    enableReleaseEndpoints: "boolean"
  }
};

function settingsPayload(config) {
  return {
    ok: true,
    configPath: getConfigPath(),
    editable: true,
    requiresAdminProfile: true,
    dangerousKeys: Array.from(DANGEROUS_KEYS).sort(),
    config: publicConfigSummary(config)
  };
}

function updateSettings(current, payload = {}) {
  requireAdmin(current);
  const next = clone(current);
  const changed = [];
  const values = payload.settings && typeof payload.settings === "object" ? payload.settings : payload;
  const confirmDangerous = Boolean(payload.confirmDangerous || values.confirmDangerous);

  if (Object.prototype.hasOwnProperty.call(values, "permissionProfile")) {
    const profile = String(values.permissionProfile || "").trim();
    if (!["read-only", "pr", "test", "admin"].includes(profile)) {
      throw new Error("Permission profile must be one of: Read-only, PR agent, Test runner, Admin.");
    }
    setIfChanged(next, "permissionProfile", profile, changed);
  }

  if (Object.prototype.hasOwnProperty.call(values, "defaultTaskMode")) {
    setIfChanged(next, "defaultTaskMode", String(values.defaultTaskMode || "implement_and_test"), changed);
  }

  if (Object.prototype.hasOwnProperty.call(values, "sandboxMode")) {
    const mode = String(values.sandboxMode || "none");
    if (!["none", "docker", "docker_readonly_base"].includes(mode)) throw new Error("Invalid sandboxMode.");
    setIfChanged(next, "sandboxMode", mode, changed);
  }

  for (const key of BOOLEAN_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    const nextValue = Boolean(values[key]);
    if (DANGEROUS_KEYS.has(key) && nextValue === true && current[key] !== true && !confirmDangerous) {
      throw new Error(`${key} is a high-risk setting. Re-submit with confirmDangerous=true to enable it.`);
    }
    setIfChanged(next, key, nextValue, changed);
  }

  for (const key of NUMBER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    setIfChanged(next, key, finiteNumber(values[key], key), changed);
  }

  for (const [section, schema] of Object.entries(NESTED_SCHEMA)) {
    if (!values[section] || typeof values[section] !== "object") continue;
    if (!next[section] || typeof next[section] !== "object") next[section] = {};
    if (schema === "booleanMap") {
      for (const [key, value] of Object.entries(values[section])) {
        if (!/^[A-Za-z0-9._-]{1,80}$/.test(key)) throw new Error(`Invalid ${section} key: ${key}`);
        setNestedIfChanged(next, section, key, Boolean(value), changed);
      }
      continue;
    }
    for (const [key, kind] of Object.entries(schema)) {
      if (!Object.prototype.hasOwnProperty.call(values[section], key)) continue;
      setNestedIfChanged(next, section, key, coerce(values[section][key], kind, `${section}.${key}`), changed);
    }
  }

  const normalized = writeConfig(next);
  return {
    ok: true,
    changed,
    message: changed.length ? `Updated ${changed.length} setting(s).` : "No setting changes detected.",
    configPath: getConfigPath(),
    config: publicConfigSummary(normalized)
  };
}

function updateWorkspace(current, payload = {}) {
  requireAdmin(current);
  const action = String(payload.action || "upsert").toLowerCase();
  const alias = String(payload.alias || payload.workspace || "").trim();
  validateAlias(alias);
  const next = clone(current);
  if (!next.workspaces || typeof next.workspaces !== "object") next.workspaces = {};

  if (action === "delete" || action === "remove") {
    if (!payload.confirmDelete) throw new Error("Workspace removal requires confirmDelete=true.");
    if (!next.workspaces[alias]) throw new Error(`Workspace '${alias}' is not configured.`);
    delete next.workspaces[alias];
    const normalized = writeConfig(next);
    return { ok: true, changed: [`workspaces.${alias}`], message: `Removed workspace '${alias}'.`, configPath: getConfigPath(), config: publicConfigSummary(normalized) };
  }

  const source = payload.workspaceConfig && typeof payload.workspaceConfig === "object" ? payload.workspaceConfig : payload;
  const currentWorkspace = next.workspaces[alias] || {};
  const workspacePath = source.path == null || source.path === "" ? currentWorkspace.path : String(source.path).trim();
  if (!workspacePath) throw new Error("Workspace path is required.");
  if (!path.isAbsolute(workspacePath)) throw new Error("Workspace path must be absolute.");
  if (!fs.existsSync(workspacePath)) throw new Error(`Workspace path does not exist: ${workspacePath}`);

  const entry = {
    ...currentWorkspace,
    path: workspacePath,
    protectedBranches: parseList(source.protectedBranches, currentWorkspace.protectedBranches || ["main", "master"]),
    defaultBaseBranch: String(source.defaultBaseBranch || currentWorkspace.defaultBaseBranch || "main"),
    allowedRemotes: parseList(source.allowedRemotes, currentWorkspace.allowedRemotes || ["origin"]),
    repoSlug: String(source.repoSlug || currentWorkspace.repoSlug || ""),
    worktreeRoot: String(source.worktreeRoot || currentWorkspace.worktreeRoot || ""),
    defaultDockerImage: String(source.defaultDockerImage || currentWorkspace.defaultDockerImage || ""),
    allowedDockerImages: parseList(source.allowedDockerImages, currentWorkspace.allowedDockerImages || []),
    dockerUser: String(source.dockerUser || currentWorkspace.dockerUser || ""),
    dockerNetworkNone: source.dockerNetworkNone == null ? currentWorkspace.dockerNetworkNone !== false : Boolean(source.dockerNetworkNone),
    allowDocker: source.allowDocker == null ? Boolean(currentWorkspace.allowDocker) : Boolean(source.allowDocker),
    allowArbitraryCommands: source.allowArbitraryCommands == null ? Boolean(currentWorkspace.allowArbitraryCommands) : Boolean(source.allowArbitraryCommands),
    allowDestructiveTools: source.allowDestructiveTools == null ? Boolean(currentWorkspace.allowDestructiveTools) : Boolean(source.allowDestructiveTools),
    testCommands: parseCommandMap(source.testCommands, currentWorkspace.testCommands || {}),
    commands: parseCommandMap(source.commands, currentWorkspace.commands || {})
  };

  const enablesDangerous = (
    entry.allowDocker && !currentWorkspace.allowDocker
    || entry.allowArbitraryCommands && !currentWorkspace.allowArbitraryCommands
    || entry.allowDestructiveTools && !currentWorkspace.allowDestructiveTools
  );
  if (enablesDangerous && !payload.confirmDangerous) {
    throw new Error("This workspace update enables high-risk capabilities. Re-submit with confirmDangerous=true.");
  }

  next.workspaces[alias] = entry;
  const normalized = writeConfig(next);
  return {
    ok: true,
    changed: [`workspaces.${alias}`],
    message: `Saved workspace '${alias}'.`,
    configPath: getConfigPath(),
    config: publicConfigSummary(normalized)
  };
}

function requireAdmin(config) {
  if (String(config.permissionProfile || "") !== "admin") {
    throw new Error("Dashboard configuration writes require permissionProfile=admin. Switch to admin, restart, then try again.");
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative number.`);
  return number;
}

function coerce(value, kind, label) {
  if (kind === "boolean") return Boolean(value);
  if (kind === "number") return finiteNumber(value, label);
  if (kind === "stringList") return parseList(value, []);
  return value;
}

function parseList(value, fallback = []) {
  if (value == null || value === "") return Array.isArray(fallback) ? fallback.map(String) : [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value).split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function parseCommandMap(value, fallback = {}) {
  if (value == null || value === "") return { ...fallback };
  if (typeof value === "object" && !Array.isArray(value)) {
    const result = {};
    for (const [key, command] of Object.entries(value)) {
      const cleanKey = String(key || "").trim();
      if (!cleanKey) continue;
      validateCommandKey(cleanKey);
      result[cleanKey] = String(command || "").trim();
    }
    return result;
  }
  const result = {};
  for (const rawLine of String(value).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) throw new Error(`Command lines must use key=command format. Bad line: ${line}`);
    const key = line.slice(0, index).trim();
    const command = line.slice(index + 1).trim();
    validateCommandKey(key);
    if (!command) throw new Error(`Command '${key}' cannot be empty.`);
    result[key] = command;
  }
  return result;
}

function validateAlias(alias) {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(alias)) throw new Error("Workspace alias must be 1-80 characters using letters, numbers, dot, underscore, or dash.");
}

function validateCommandKey(key) {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(key)) throw new Error(`Invalid command key: ${key}`);
}

function setIfChanged(target, key, value, changed) {
  if (JSON.stringify(target[key]) !== JSON.stringify(value)) {
    target[key] = value;
    changed.push(key);
  }
}

function setNestedIfChanged(target, section, key, value, changed) {
  if (!target[section] || typeof target[section] !== "object") target[section] = {};
  if (JSON.stringify(target[section][key]) !== JSON.stringify(value)) {
    target[section][key] = value;
    changed.push(`${section}.${key}`);
  }
}

module.exports = {
  settingsPayload,
  updateSettings,
  updateWorkspace
};
