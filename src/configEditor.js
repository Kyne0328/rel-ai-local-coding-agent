const fs = require("node:fs");
const path = require("node:path");
const { getConfigPath, publicConfigSummary, writeConfig, normalizeAutoApproveConfig } = require("./config");

const BOOLEAN_KEYS = ["trustedLocalAgent", "dashboardEnabled"];
const NUMBER_KEYS = ["maxOutputBytes", "maxIndexFiles"];

const DEFAULT_FAST_TASK = {
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

function settingsPayload(config) {
  return {
    ok: true,
    configPath: getConfigPath(),
    editable: true,
    design: "single_local_repo_bridge",
    removedLegacyWorkflows: ["patch", "shell", "task-runner", "worktree", "multi-agent", "approval-gates", "docker", "pr-ci-repair"],
    config: publicConfigSummary(config)
  };
}

function updateSettings(current, payload = {}) {
  const next = clone(current);
  const changed = [];
  const values = payload.settings && typeof payload.settings === "object" ? payload.settings : payload;

  setIfChanged(next, "toolMode", "chatgpt_local_repo", changed);
  setIfChanged(next, "trustedLocalAgent", true, changed);

  for (const key of BOOLEAN_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    setIfChanged(next, key, Boolean(values[key]), changed);
  }

  for (const key of NUMBER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    setIfChanged(next, key, finiteNumber(values[key], key), changed);
  }

  if (values.autoApproveAppRequests && typeof values.autoApproveAppRequests === "object") {
    next.autoApproveAppRequests = normalizeAutoApproveConfig({ ...(next.autoApproveAppRequests || {}), ...values.autoApproveAppRequests });
    changed.push("autoApproveAppRequests");
  }

  for (const section of ["productUx", "release"]) {
    if (!values[section] || typeof values[section] !== "object") continue;
    if (!next[section] || typeof next[section] !== "object") next[section] = {};
    for (const [key, value] of Object.entries(values[section])) {
      const coerced = typeof value === "boolean" ? Boolean(value) : (typeof value === "number" || /^\d+$/.test(String(value)) ? finiteNumber(value, `${section}.${key}`) : value);
      setNestedIfChanged(next, section, key, coerced, changed);
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

  if (action === "rename") {
    const newAlias = String(payload.newAlias || "").trim();
    validateAlias(newAlias);
    if (!next.workspaces[alias]) throw new Error(`Workspace '${alias}' is not configured.`);
    if (alias === newAlias) return { ok: true, changed: [], message: "Workspace alias unchanged.", configPath: getConfigPath(), config: publicConfigSummary(current) };
    if (next.workspaces[newAlias]) throw new Error(`Workspace '${newAlias}' already exists.`);
    next.workspaces[newAlias] = { ...next.workspaces[alias] };
    delete next.workspaces[alias];
    const normalized = writeConfig(next);
    return { ok: true, changed: [`workspaces.${alias}`, `workspaces.${newAlias}`], message: `Renamed workspace '${alias}' to '${newAlias}'.`, configPath: getConfigPath(), config: publicConfigSummary(normalized) };
  }

  const source = payload.workspaceConfig && typeof payload.workspaceConfig === "object" ? payload.workspaceConfig : payload;
  const currentWorkspace = next.workspaces[alias] || {};
  const workspacePath = source.path == null || source.path === "" ? currentWorkspace.path : String(source.path).trim();
  if (!workspacePath) throw new Error("Workspace path is required.");
  if (!path.isAbsolute(workspacePath)) throw new Error("Workspace path must be absolute.");
  if (!fs.existsSync(workspacePath)) throw new Error(`Workspace path does not exist: ${workspacePath}`);

  next.workspaces[alias] = {
    ...currentWorkspace,
    path: workspacePath,
    protectedBranches: parseList(source.protectedBranches, currentWorkspace.protectedBranches || ["main", "master"]),
    defaultBaseBranch: String(source.defaultBaseBranch || currentWorkspace.defaultBaseBranch || "main"),
    allowedRemotes: parseList(source.allowedRemotes, currentWorkspace.allowedRemotes || ["origin"]),
    repoSlug: String(source.repoSlug || currentWorkspace.repoSlug || ""),
    fastTask: parseFastTask(source.fastTask, currentWorkspace.fastTask),
    testCommands: parseCommandMap(source.testCommands, currentWorkspace.testCommands || {}),
    commands: parseCommandMap(source.commands, currentWorkspace.commands || {})
  };

  const normalized = writeConfig(next);
  return {
    ok: true,
    changed: [`workspaces.${alias}`],
    message: `Saved workspace '${alias}'.`,
    configPath: getConfigPath(),
    config: publicConfigSummary(normalized)
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative number.`);
  return number;
}

function parseList(value, fallback = []) {
  if (value == null || value === "") return Array.isArray(fallback) ? fallback.map(String) : [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value).split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function parseFastTask(value, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  const current = fallback && typeof fallback === "object" ? { ...DEFAULT_FAST_TASK, ...fallback } : { ...DEFAULT_FAST_TASK };
  const maxIndexFiles = source.maxIndexFiles == null ? current.maxIndexFiles : finiteNumber(source.maxIndexFiles, "fastTask.maxIndexFiles");
  return {
    ...current,
    enabled: source.enabled == null ? current.enabled !== false : Boolean(source.enabled),
    skipIndexForSmallTasks: source.skipIndexForSmallTasks == null ? current.skipIndexForSmallTasks !== false : Boolean(source.skipIndexForSmallTasks),
    preferChangedFiles: source.preferChangedFiles == null ? current.preferChangedFiles !== false : Boolean(source.preferChangedFiles),
    maxIndexFiles: maxIndexFiles || 750,
    includeRoots: parseList(source.includeRoots, current.includeRoots || []),
    excludePaths: parseList(source.excludePaths, current.excludePaths || [])
  };
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
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(key)) throw new Error(`Invalid command key: ${key}`);
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

module.exports = { settingsPayload, updateSettings, updateWorkspace };
