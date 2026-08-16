import * as path from "node:path";
import { getConfigPath, makeDefaultContextConfig, publicConfigSummary, writeConfig } from './config.js';
import { assertSafeWorkspaceRoot } from './workspaceSafety.js';

// Only these nested keys may be written through the settings API; anything else is
// rejected so junk keys never persist into config.json.
const ALLOWED_SECTION_KEYS = {
  productUx: new Set(["staleHours", "cleanupOlderThanHours", "enableStateExport"]),
  release: new Set(["minimumReadinessScore", "requireHttpToken"]),
  telemetry: new Set(["enabled", "endpoint"])
};

function settingsPayload(config) {
  return {
    ok: true,
    configPath: getConfigPath(),
    editable: true,
    design: "single_local_repo_bridge",
    config: publicConfigSummary(config)
  };
}

function updateSettings(current, payload = {}) {
  const next = clone(current);
  const changed = [];
  const values = payload.settings && typeof payload.settings === "object" ? payload.settings : payload;

  applyAllowedSections(next, values, changed);

  const normalized = writeConfig(next);
  return {
    ok: true,
    changed,
    message: changed.length ? `Updated ${changed.length} setting(s).` : "No setting changes detected.",
    configPath: getConfigPath(),
    config: publicConfigSummary(normalized)
  };
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function coerceSettingValue(value, label, currentValue) {
  if (typeof currentValue === "boolean") {
    if (typeof value === "boolean") return value;
    if (String(value).toLowerCase() === "true") return true;
    if (String(value).toLowerCase() === "false") return false;
    throw new Error(`${label} must be true or false.`);
  }
  if (typeof currentValue === "number") return finiteNumber(value, label);
  return String(value);
}

function applyAllowedSection(next, values, section, changed) {
  if (!values[section] || typeof values[section] !== "object") return;
  if (!next[section] || typeof next[section] !== "object") next[section] = {};
  for (const [key, value] of Object.entries(values[section])) {
    if (!ALLOWED_SECTION_KEYS[section].has(key)) {
      throw new Error(`Unknown ${section} setting: ${key}. Allowed: ${[...ALLOWED_SECTION_KEYS[section]].join(", ")}.`);
    }
    setNestedIfChanged(next, section, key, coerceSettingValue(value, `${section}.${key}`, next[section][key]), changed);
  }
}

function applyAllowedSections(next, values, changed) {
  for (const section of ["productUx", "release", "telemetry"]) applyAllowedSection(next, values, section, changed);
}

function _handleDeleteWorkspace(alias, payload, next) {
  if (!payload.confirmDelete && !payload.confirmClear) throw new Error("Workspace removal requires confirmDelete=true (or confirmClear=true).");
  if (!next.workspaces[alias]) throw new Error(`Workspace '${alias}' is not configured.`);
  delete next.workspaces[alias];
  const normalized = writeConfig(next);
  return { ok: true, changed: [`workspaces.${alias}`], message: `Removed workspace '${alias}'.`, configPath: getConfigPath(), config: publicConfigSummary(normalized) };
}

function _handleUpsertWorkspace(alias, payload, next) {
  const source = payload.workspaceConfig && typeof payload.workspaceConfig === "object" ? payload.workspaceConfig : payload;
  const mode = String(source.mode || payload.mode || "").trim().toLowerCase();
  const originalAlias = String(source.originalAlias || payload.originalAlias || alias).trim();
  validateAlias(originalAlias);
  if (mode === "create" && next.workspaces[alias]) throw new Error(`Workspace '${alias}' already exists.`);
  if (mode === "update" && !next.workspaces[originalAlias]) throw new Error(`Workspace '${originalAlias}' is not configured.`);
  if (originalAlias !== alias && next.workspaces[alias]) throw new Error(`Workspace '${alias}' already exists.`);

  const currentWorkspace = objectOrEmpty(next.workspaces[originalAlias]);
  const workspacePath = source.path == null || source.path === "" ? currentWorkspace.path : String(source.path).trim();
  if (!workspacePath) throw new Error("Workspace path is required.");
  if (!path.isAbsolute(workspacePath)) throw new Error("Workspace path must be absolute.");
  assertSafeWorkspaceRoot(workspacePath);

  if (source.enforceUniquePath === true || payload.enforceUniquePath === true || mode === "create" || mode === "update") {
    const duplicateAlias = workspaceAliasForPath(next.workspaces, workspacePath, originalAlias);
    if (duplicateAlias) throw new Error(`Project folder is already configured as workspace '${duplicateAlias}'.`);
  }

  if (originalAlias !== alias) delete next.workspaces[originalAlias];
  next.workspaces[alias] = {
    ...currentWorkspace,
    path: workspacePath,
    repoSlug: String(source.repoSlug || currentWorkspace.repoSlug || ""),
    context: parseContext(source.context, currentWorkspace.context)
  };
  const normalized = writeConfig(next);
  return {
    ok: true,
    changed: originalAlias === alias ? [`workspaces.${alias}`] : [`workspaces.${originalAlias}`, `workspaces.${alias}`],
    renamedFrom: originalAlias === alias ? "" : originalAlias,
    message: originalAlias === alias ? `Saved workspace '${alias}'.` : `Renamed workspace '${originalAlias}' to '${alias}'.`,
    configPath: getConfigPath(),
    config: publicConfigSummary(normalized)
  };
}

function workspaceAliasForPath(workspaces, workspacePath, excludedAlias = "") {
  const target = normalizedWorkspacePath(workspacePath);
  for (const [candidateAlias, candidate] of Object.entries(objectOrEmpty(workspaces))) {
    if (candidateAlias === excludedAlias || !candidate?.path) continue;
    if (normalizedWorkspacePath(candidate.path) === target) return candidateAlias;
  }
  return "";
}

function normalizedWorkspacePath(value) {
  const resolved = path.resolve(String(value || "").trim()).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

const WORKSPACE_ACTION_HANDLERS = {
  upsert: _handleUpsertWorkspace,
  delete: _handleDeleteWorkspace,
  clear: _handleDeleteWorkspace
};

function updateWorkspace(current, payload = {}) {
  const action = String(payload.action || "upsert").toLowerCase();
  const alias = String(payload.alias || payload.workspace || "").trim();
  validateAlias(alias);
  const next = clone(current);
  if (!next.workspaces || typeof next.workspaces !== "object") next.workspaces = {};

  const handler = WORKSPACE_ACTION_HANDLERS[action];
  if (!handler) {
    throw new Error(`Unknown workspace action: ${action}. Allowed: ${Object.keys(WORKSPACE_ACTION_HANDLERS).join(", ")}.`);
  }
  return handler(alias, payload, next);
}

function clone(value) {
  return structuredClone(objectOrEmpty(value));
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

function parseContext(value, fallback = {}) {
  const source = objectOrEmpty(value);
  const defaults = makeDefaultContextConfig();
  const current = { ...defaults, ...objectOrEmpty(fallback) };
  const snapshotMaxFiles = source.snapshotMaxFiles == null
    ? current.snapshotMaxFiles
    : finiteNumber(source.snapshotMaxFiles, "context.snapshotMaxFiles");
  return {
    ...current,
    snapshotMaxFiles: snapshotMaxFiles || defaults.snapshotMaxFiles,
    includeRoots: parseList(source.includeRoots, current.includeRoots || []),
    excludePaths: parseList(source.excludePaths, current.excludePaths || [])
  };
}

function validateAlias(alias) {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(alias)) throw new Error("Workspace alias must be 1-80 characters using letters, numbers, dot, underscore, or dash.");
}

function setNestedIfChanged(target, section, key, value, changed) {
  if (!target[section] || typeof target[section] !== "object") target[section] = {};
  if (JSON.stringify(target[section][key]) !== JSON.stringify(value)) {
    target[section][key] = value;
    changed.push(`${section}.${key}`);
  }
}

export { settingsPayload, updateSettings, updateWorkspace };
