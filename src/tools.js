const fs = require("node:fs");
const { readConfig, resolveWorkspace } = require("./config");
const { collectTextFiles, collectOptionsFromWorkspace, resolveSafePath } = require("./safety");
const { logAudit } = require("./audit");
const { discoverCommands } = require("./commandDiscovery");
const { summarizeOperations } = require("./journal");
const { repoSnapshot, relaiRead, relaiWrite, relaiReplace, relaiClear, relaiApplyPatch, relaiApplyArchive, relaiSnapshotArchive, relaiVerify, relaiBrowser, relaiDiff, relaiReset } = require("./localRepoBridge");

const STALE_TOOL_HINTS = {
  relai_verify:           "relai_verify was renamed to relai_run_checks. Please use relai_run_checks instead.",
  relai_reset:            "relai_reset was renamed to relai_restore_changes. Please use relai_restore_changes instead.",
  relai_delete:           "relai_delete was renamed to relai_clear_files. Please use relai_clear_files instead.",
  relai_apply_patch:      "relai_apply_patch was renamed to relai_apply_update. Please use relai_apply_update instead.",
  relai_apply_archive:    "relai_apply_archive was renamed to relai_apply_bundle. Please use relai_apply_bundle instead.",
  relai_snapshot_archive: "relai_snapshot_archive was renamed to relai_package_snapshot. Please use relai_package_snapshot instead.",
};

const BRIDGE_TOOL_NAMES = [
  "relai_repo_snapshot",
  "relai_read",
  "relai_write",
  "relai_replace",
  "relai_clear_files",
  "relai_apply_update",
  "relai_apply_bundle",
  "relai_package_snapshot",
  "relai_run_checks",
  "relai_browser",
  "relai_diff",
  "relai_restore_changes",
  "relai_status",
  "relai_feature_probe"
];

const toolSchemas = [
  tool("relai_repo_snapshot", "Repository Snapshot", "Compact repository overview: file tree, manifests, detected checks, and project hints.", {
    workspace: stringProp(), maxEntries: numberProp(1, 20000), includeFiles: boolProp()
  }, ["workspace"]),
  tool("relai_read", "Read Local Repo Paths", "Batch-read files or directory summaries from the workspace.", {
    workspace: stringProp(), paths: arrayProp("string", 1, 100), maxBytes: numberProp(1000, 10485760), maxEntries: numberProp(1, 20000)
  }, ["workspace", "paths"]),
  tool("relai_write", "Write Local Repo File", "Full-file replacement. Use direct { workspace, path, content } for complete-file updates. Use staged mode for very large files.", {
    workspace: stringProp(), path: stringProp(), content: stringProp(), dryRun: boolProp(), stage: stringProp(), writeId: stringProp()
  }, ["workspace"]),
  tool("relai_replace", "Replace Exact Text", "Small deterministic edits inside an existing file. Provide { workspace, path, oldText, newText } or replacements: [{ oldText, newText, occurrence? }]. Duplicate matches require occurrence.", {
    workspace: stringProp(),
    path: stringProp(),
    oldText: stringProp(),
    newText: stringProp(),
    expectedSha256: stringProp(),
    occurrence: numberProp(1, 1000000),
    replacements: arrayObjectProp({ oldText: stringProp(), newText: stringProp(), occurrence: numberProp(1, 1000000) }, ["oldText", "newText"], 1, 50),
    dryRun: boolProp()
  }, ["workspace", "path"]),
  tool("relai_clear_files", "Clear Local Repo Files", "Clear one or more files from a configured workspace. Folders are refused. Supports dryRun and failIfMissing.", {
    workspace: stringProp(), path: stringProp(), paths: arrayProp("string", 1, 100), expectedSha256: stringProp(), dryRun: boolProp(), failIfMissing: boolProp()
  }, ["workspace"]),
  tool("relai_apply_update", "Apply Prepared Update", "Apply a prepared text update to the workspace and optionally run checks afterward.", {
    workspace: stringProp(), updateText: stringProp(), backup: boolProp(), check: stringProp(), checks: arrayProp("string", 0), checksText: stringProp(), timeoutMs: numberProp(1000, 86400000), stopOnFailure: boolProp(), returnDiff: boolProp(), maxResultBytes: numberProp(1000, 5242880)
  }, ["workspace"]),
  tool("relai_apply_bundle", "Apply Prepared Bundle", "Apply a prepared file bundle to the workspace and optionally run checks afterward.", {
    workspace: stringProp(), bundlePath: stringProp(), path: stringProp(), stripRoot: boolProp(), clearMissing: boolProp(), backup: boolProp(), check: stringProp(), checks: arrayProp("string", 0), checksText: stringProp(), timeoutMs: numberProp(1000, 86400000), stopOnFailure: boolProp(), returnDiff: boolProp(), maxResultBytes: numberProp(1000, 5242880)
  }, ["workspace"]),
  tool("relai_package_snapshot", "Package Workspace Zip", "Create a zip package of the current workspace on the MCP host, excluding repo internals, dependency caches, build outputs, and Rel.AI state.", {
    workspace: stringProp(), maxFiles: numberProp(1, 200000), timeoutMs: numberProp(1000, 86400000)
  }, ["workspace"]),
  tool("relai_run_checks", "Run Workspace Checks", "Run workspace validation checks such as tests, analyzers, linters, and build checks.", {
    workspace: stringProp(),
    level: stringProp(),
    check: stringProp(),
    checks: arrayProp("string", 0),
    checksText: stringProp(),
    timeoutMs: numberProp(1000, 86400000),
    stopOnFailure: boolProp()
  }, ["workspace"]),
  tool("relai_browser", "Browser/UI Check", "UI validation bridge. Fetch a URL/route or run a local browser check such as Playwright; returns output and errors.", {
    workspace: stringProp(), url: stringProp(), route: stringProp(), check: stringProp(), timeoutMs: numberProp(1000, 1800000)
  }, ["workspace"]),
  tool("relai_diff", "Review Local Repo Diff", "Return git status and current diff as a review artifact.", {
    workspace: stringProp(), staged: boolProp(), path: stringProp(), maxBytes: numberProp(1000, 5242880)
  }, ["workspace"]),
  tool("relai_restore_changes", "Restore Workspace Changes", "Restore selected workspace changes, or restore the workspace to the last git state.", {
    workspace: stringProp(), paths: arrayProp("string", 0, 100), mode: stringProp(), clean: boolProp()
  }, ["workspace"]),
  tool("relai_status", "Rel.AI Status", "Compact live status for configured workspaces, scripts, and CI references. Prefer this over reading source files when checking whether an update is active.", {
    workspace: stringProp()
  }),
  tool("relai_feature_probe", "Rel.AI Feature Probe", "Compact booleans for important runtime behavior. Prefer this over source reads when checking installed behavior.", {
    workspace: stringProp()
  })
];

const TOOL_NAMES = new Set(toolSchemas.map((item) => item.name));
function getToolSchemas() {
  return toolSchemas;
}

function isToolCallable(name) {
  return TOOL_NAMES.has(name);
}

async function callTool(name, args = {}) {
  const config = readConfig();
  const started = Date.now();
  const canonicalName = name;
  try {
    if (STALE_TOOL_HINTS[name]) {
      throw new Error(STALE_TOOL_HINTS[name]);
    }
    if (!isToolCallable(name)) {
      throw new Error(`Unknown tool '${name}'. Available tools: ${BRIDGE_TOOL_NAMES.join(", ")}. Restart/reconnect ChatGPT if the tool list looks stale.`);
    }
    const value = await dispatchTool(config, canonicalName, args || {});
    logAudit(config, { tool: canonicalName, ok: true, workspace: args && args.workspace, ms: Date.now() - started });
    return ok(value);
  } catch (error) {
    logAudit(config, { tool: canonicalName, ok: false, workspace: args && args.workspace, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function dispatchTool(config, name, args) {
  switch (name) {
    case "relai_repo_snapshot":
      return withWorkspace(config, args, (workspace) => repoSnapshot(workspace, config, args));
    case "relai_read":
      return withWorkspace(config, args, (workspace) => relaiRead(workspace, args));
    case "relai_write":
      return withWorkspace(config, args, (workspace) => relaiWrite(workspace, config, args));
    case "relai_replace":
      return withWorkspace(config, args, (workspace) => relaiReplace(workspace, config, args));
    case "relai_clear_files":
      return withWorkspace(config, args, (workspace) => relaiClear(workspace, config, args));
    case "relai_apply_update":
      return withWorkspace(config, args, (workspace) => relaiApplyPatch(workspace, config, mapCheckArgs({ ...args, patch: args.updateText || args.patch || args.diff })));
    case "relai_apply_bundle":
      return withWorkspace(config, args, (workspace) => relaiApplyArchive(workspace, config, mapCheckArgs({ ...args, archivePath: args.archivePath || args.bundlePath || args.path, bundlePath: args.bundlePath || args.archivePath || args.path, deleteMissing: args.clearMissing })));
    case "relai_package_snapshot":
      return withWorkspace(config, args, (workspace) => relaiSnapshotArchive(workspace, config, args));
    case "relai_run_checks":
      return withWorkspace(config, args, (workspace) => relaiVerify(workspace, config, mapCheckArgs(args)));
    case "relai_browser":
      return withWorkspace(config, args, (workspace) => relaiBrowser(workspace, config, { ...args, command: args.command || args.check }));
    case "relai_diff":
      return withWorkspace(config, args, (workspace) => relaiDiff(workspace, config, args));
    case "relai_restore_changes":
      return withWorkspace(config, args, (workspace) => relaiReset(workspace, config, args));
    case "relai_status":
      return relaiStatus(config, args);
    case "relai_feature_probe":
      return relaiFeatureProbe(config, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function mapCheckArgs(args = {}) {
  return {
    ...args,
    command: args.command || args.check,
    commands: args.commands || args.checks,
    commandsText: args.commandsText || args.checksText
  };
}

async function withWorkspace(config, request, fn) {
  const alias = request && request.workspace;
  const workspace = resolveWorkspace(config, alias);
  return fn(workspace);
}

function relaiStatus(config, args = {}) {
  const packageJson = safeReadPackageJson();
  const scripts = packageJson.scripts || {};
  const ci = ciScriptStatus(scripts);
  let selectedWorkspace = null;
  if (args.workspace) {
    try {
      const workspace = resolveWorkspace(config, args.workspace);
      const discovered = discoverCommands(workspace.path);
      const commandKeys = Object.keys(workspace.commands || {}).sort();
      const testCommandKeys = Object.keys(workspace.testCommands || {}).sort();
      const staleCommandKeys = commandKeys.filter((k) => {
        const cmd = (workspace.commands || {})[k];
        return cmd && !Object.values(discovered).includes(cmd) && !discovered[cmd];
      });
      const staleTestCommandKeys = testCommandKeys.filter((k) => {
        const cmd = (workspace.testCommands || {})[k];
        return cmd && !Object.values(discovered).includes(cmd) && !discovered[cmd];
      });
      selectedWorkspace = {
        alias: workspace.alias,
        root: workspace.path,
        commandKeys,
        testCommandKeys,
        ...(staleCommandKeys.length > 0 ? { staleCommandKeys } : {}),
        ...(staleTestCommandKeys.length > 0 ? { staleTestCommandKeys } : {})
      };
    } catch (error) {
      selectedWorkspace = { alias: String(args.workspace), error: error instanceof Error ? error.message : String(error) };
    }
  }
  return {
    ok: true,
    version: packageJson.version || "",
    tools: BRIDGE_TOOL_NAMES,
    scripts: Object.keys(scripts).sort(),
    ci,
    workspace: selectedWorkspace,
    workspaceCount: Object.keys(config.workspaces || {}).length
  };
}

function relaiFeatureProbe(config, args = {}) {
  const scripts = safeReadPackageJson().scripts || {};
  const ci = ciScriptStatus(scripts);
  return {
    ok: true,
    lenientHash: true,
    directWrites: true,
    fastUpdateDefault: true,
    cleanCheckOptIn: true,
    ciHealthCheck: Boolean(scripts["test:repo-health"] && ci.ok),
    softerToolNames: true,
    tools: BRIDGE_TOOL_NAMES,
    workspaceRequested: args.workspace || ""
  };
}

function ciScriptStatus(scripts) {
  const workflowDir = require("node:path").join(process.cwd(), ".github", "workflows");
  const missing = [];
  const files = [];
  if (fs.existsSync(workflowDir)) collectWorkflowFiles(workflowDir, files);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/npm\s+run\s+([A-Za-z0-9:_-]+)/g)) {
      if (!scripts[match[1]]) missing.push({ file: file.replace(process.cwd() + require("node:path").sep, ""), script: match[1] });
    }
  }
  return { ok: missing.length === 0, files: files.length, missing };
}

function collectWorkflowFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = require("node:path").join(dir, entry.name);
    if (entry.isDirectory()) collectWorkflowFiles(full, out);
    else if (/\.ya?ml$/i.test(entry.name)) out.push(full);
  }
}

function safeReadPackageJson() {
  try {
    return JSON.parse(fs.readFileSync(require("node:path").join(process.cwd(), "package.json"), "utf8"));
  } catch (_error) {
    return {};
  }
}

function workspaceList(config) {
  const workspaces = Object.entries(config.workspaces || {}).map(([alias, item]) => ({
    alias,
    path: item.path,
    repoSlug: item.repoSlug || "",
    testCommandKeys: Object.keys(item.testCommands || {}).sort(),
    commandKeys: Object.keys(item.commands || {}).sort(),
    protectedBranches: Array.isArray(item.protectedBranches) ? item.protectedBranches : [],
    fastTask: item.fastTask || {}
  })).sort((a, b) => a.alias.localeCompare(b.alias));
  return { ok: true, count: workspaces.length, workspaces };
}

function workspaceInspect(config, args = {}) {
  const requested = String(args.workspace || "").trim();
  try {
    const profile = workspaceProfile(config, args);
    const tree = workspaceTree(config, { ...args, maxEntries: Math.min(Math.max(Number(args.maxEntries || 800), 1), 5000) });
    return {
      ok: true,
      workspace: profile.workspace,
      root: profile.root,
      profile,
      tree: {
        fileCount: tree.fileCount,
        files: tree.files,
        skipped: tree.skipped,
        truncated: tree.truncated
      },
      requiredFlow: BRIDGE_TOOL_NAMES,
      operationJournal: summarizeOperations(config, { alias: profile.workspace, path: profile.root }, args.journalLimit || 10)
    };
  } catch (error) {
    return {
      ok: false,
      workspace: requested,
      error: error instanceof Error ? error.message : String(error),
      availableWorkspaces: workspaceList(config).workspaces
    };
  }
}

function workspaceTree(config, args = {}) {
  const workspace = resolveWorkspace(config, args.workspace);
  const result = collectTextFiles(workspace.path, collectOptionsFromWorkspace(workspace, { maxEntries: args.maxEntries }));
  return {
    workspace: workspace.alias,
    root: workspace.path,
    fileCount: result.files.length,
    files: result.files,
    skipped: result.skipped.slice(0, 300),
    truncated: result.truncated
  };
}

function workspaceProfile(config, args = {}) {
  const workspace = resolveWorkspace(config, args.workspace);
  const manifests = [
    "package.json", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lockb",
    "pyproject.toml", "requirements.txt", "poetry.lock", "Pipfile",
    "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "gradlew", "composer.json", "Gemfile", ".csproj", "pubspec.yaml"
  ];
  const present = [];
  for (const manifest of manifests) {
    try {
      const safe = resolveSafePath(workspace.path, manifest);
      if (fs.existsSync(safe.absolutePath)) present.push(manifest);
    } catch (_error) {}
  }
  const hints = [];
  if (present.includes("package.json")) hints.push("Node/JavaScript/TypeScript project");
  if (present.includes("pnpm-lock.yaml")) hints.push("Likely package manager: pnpm");
  else if (present.includes("yarn.lock")) hints.push("Likely package manager: yarn");
  else if (present.includes("package-lock.json")) hints.push("Likely package manager: npm");
  if (present.includes("pyproject.toml") || present.includes("requirements.txt")) hints.push("Python project");
  if (present.includes("Cargo.toml")) hints.push("Rust project");
  if (present.includes("go.mod")) hints.push("Go project");
  if (present.includes("pubspec.yaml")) hints.push("Flutter/Dart project");
  const discovered = discoverCommands(workspace.path);
  return {
    workspace: workspace.alias,
    root: workspace.path,
    manifests: present,
    hints,
    configuredTestCommands: Object.keys(workspace.testCommands || {}).sort(),
    configuredCommands: Object.keys(workspace.commands || {}).sort(),
    discoveredCommands: discovered,
    discoveredCommandCount: Object.keys(discovered).length
  };
}

function ok(value) {
  return value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "ok")
    ? value
    : { ok: true, ...value };
}

function tool(name, title, description, properties, required = []) {
  return {
    name,
    title,
    description,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    annotations: { readOnlyHint: false }
  };
}
function stringProp() { return { type: "string" }; }
function boolProp() { return { type: "boolean" }; }
function numberProp(min, max) { return { type: "number", minimum: min, maximum: max }; }
function arrayProp(type, minItems, maxItems) {
  const schema = { type: "array", items: { type } };
  if (Number.isFinite(Number(minItems))) schema.minItems = minItems;
  if (Number.isFinite(Number(maxItems))) schema.maxItems = maxItems;
  return schema;
}

function arrayObjectProp(properties, required = [], minItems, maxItems) {
  const schema = { type: "array", items: { type: "object", properties, required, additionalProperties: false } };
  if (Number.isFinite(Number(minItems))) schema.minItems = minItems;
  if (Number.isFinite(Number(maxItems))) schema.maxItems = maxItems;
  return schema;
}

module.exports = { toolSchemas, allToolSchemas: toolSchemas, getToolSchemas, BRIDGE_TOOL_NAMES, callTool, workspaceList, workspaceInspect, workspaceTree, workspaceProfile };
