const fs = require("node:fs");
const { readConfig, resolveWorkspace, publicConfigSummary } = require("./config");
const { collectTextFiles, collectOptionsFromWorkspace, resolveSafePath } = require("./safety");
const { readAudit, logAudit } = require("./audit");
const { discoverCommands } = require("./commandDiscovery");
const { summarizeOperations } = require("./journal");
const { repoSnapshot, relaiRead, relaiWrite, relaiVerify, relaiBrowser, relaiDiff, relaiReset } = require("./localRepoBridge");
const pkg = require("../package.json");

const BRIDGE_TOOL_NAMES = [
  "relai_repo_snapshot",
  "relai_read",
  "relai_write",
  "relai_verify",
  "relai_browser",
  "relai_diff",
  "relai_reset"
];

const allToolSchemas = [
  tool("relai_version", "Version Info", "MCP server version, runtime info, and local bridge capabilities.", {}),
  tool("relai_config", "Rel.AI MCP Config Summary", "Active config summary: workspace aliases and local bridge settings. No secrets.", {}),
  tool("relai_audit_tail", "Audit Log Tail", "Recent audit log entries.", { limit: numberProp(1, 1000) }),
  tool("relai_workspace_list", "Workspace List", "Configured workspace aliases and safe metadata.", {}),
  tool("relai_workspace_inspect", "Workspace Inspect", "Combined workspace profile and filtered project structure.", { workspace: stringProp(), maxEntries: numberProp(1, 5000) }, ["workspace"]),
  tool("relai_repo_snapshot", "Repository Snapshot", "Local repository snapshot: filtered file tree, manifests, discovered commands, and project hints.", {
    workspace: stringProp(), maxEntries: numberProp(1, 20000), includeFiles: boolProp()
  }, ["workspace"]),
  tool("relai_read", "Read Local Repo Paths", "Batch-read files or directory summaries from the workspace. Mirrors reading files from an uploaded zip.", {
    workspace: stringProp(), paths: arrayProp("string", 1, 100), maxBytes: numberProp(1000, 10485760), maxEntries: numberProp(1, 20000)
  }, ["workspace", "paths"]),
  tool("relai_write", "Write Local Repo Files", "Deterministic structured writes. The only normal edit path. Supports writeFile, replaceExact, replaceFirst, replaceAll, insertBefore, insertAfter, replaceBetween, deleteBetween, and replaceFunction.", {
    workspace: stringProp(), edits: arrayProp("object", 1, 200), dryRun: boolProp()
  }, ["workspace", "edits"]),
  tool("relai_verify", "Verify Local Repo", "Auto-detect and run local verification commands such as syntax checks, tests, and builds.", {
    workspace: stringProp(), level: stringProp(), commands: arrayProp("string", 0, 50), timeoutMs: numberProp(1000, 1800000), stopOnFailure: boolProp()
  }, ["workspace"]),
  tool("relai_browser", "Browser/UI Check", "UI validation bridge. Fetch a URL/route or run a local browser command such as Playwright; returns output and errors.", {
    workspace: stringProp(), url: stringProp(), route: stringProp(), command: stringProp(), timeoutMs: numberProp(1000, 1800000)
  }, ["workspace"]),
  tool("relai_diff", "Review Local Repo Diff", "Return git status and current diff. Diffs are output-only review artifacts, not an edit path.", {
    workspace: stringProp(), staged: boolProp(), path: stringProp(), maxBytes: numberProp(1000, 5242880)
  }, ["workspace"]),
  tool("relai_reset", "Reset Local Repo Changes", "Rollback local changes by paths, or run git reset --hard with mode='hard'.", {
    workspace: stringProp(), paths: arrayProp("string", 0, 100), mode: stringProp(), clean: boolProp()
  }, ["workspace"])
];

const TOOL_NAMES = new Set(allToolSchemas.map((item) => item.name));
const APPROVAL_GATES = new Set();
const toolSchemas = getToolSchemas();

function getToolSchemas() {
  return allToolSchemas.filter((tool) => BRIDGE_TOOL_NAMES.includes(tool.name));
}

function isToolCallable(name) {
  return TOOL_NAMES.has(name);
}

async function callTool(name, args = {}) {
  const config = readConfig();
  const started = Date.now();
  try {
    if (!isToolCallable(name)) {
      throw new Error(`Unknown tool '${name}'. This MCP exposes one bridge workflow only: ${BRIDGE_TOOL_NAMES.join(", ")}.`);
    }
    const value = await dispatchTool(config, name, args || {});
    logAudit(config, { tool: name, ok: true, workspace: args && args.workspace, ms: Date.now() - started });
    return ok(value);
  } catch (error) {
    logAudit(config, { tool: name, ok: false, workspace: args && args.workspace, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function dispatchTool(config, name, args) {
  switch (name) {
    case "relai_version":
      return versionInfo(config);
    case "relai_config":
      return publicConfigSummary(config);
    case "relai_audit_tail":
      return readAudit(config, { limit: args.limit });
    case "relai_workspace_list":
      return workspaceList(config);
    case "relai_workspace_inspect":
      return workspaceInspect(config, args);
    case "relai_repo_snapshot":
      return withWorkspace(config, args, (workspace) => repoSnapshot(workspace, config, args));
    case "relai_read":
      return withWorkspace(config, args, (workspace) => relaiRead(workspace, args));
    case "relai_write":
      return withWorkspace(config, args, (workspace) => relaiWrite(workspace, config, args));
    case "relai_verify":
      return withWorkspace(config, args, (workspace) => relaiVerify(workspace, config, args));
    case "relai_browser":
      return withWorkspace(config, args, (workspace) => relaiBrowser(workspace, config, args));
    case "relai_diff":
      return withWorkspace(config, args, (workspace) => relaiDiff(workspace, config, args));
    case "relai_reset":
      return withWorkspace(config, args, (workspace) => relaiReset(workspace, config, args));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function withWorkspace(config, request, fn) {
  const alias = request && request.workspace;
  const workspace = resolveWorkspace(config, alias);
  return fn(workspace);
}

function versionInfo() {
  return {
    name: pkg.name,
    version: pkg.version,
    node: process.version,
    pid: process.pid,
    transports: ["stdio", "streamable-http", "sse"],
    toolCount: allToolSchemas.length,
    bridgeToolCount: BRIDGE_TOOL_NAMES.length,
    capabilities: [
      "single local repo bridge workflow",
      "snapshot -> read -> write -> verify -> diff -> reset",
      "deterministic structured file writes",
      "filtered repository snapshots",
      "auto-detected verification commands",
      "git diff review and rollback"
    ],
    removedWorkflows: [
      "unified patch tools",
      "generated patch scripts",
      "ad-hoc shell tool",
      "task runner/worktree orchestration",
      "multi-agent scheduler",
      "approval-gated legacy flows",
      "Docker workflow runner",
      "PR/CI repair workflows"
    ]
  };
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
    annotations: { readOnlyHint: !["relai_write", "relai_verify", "relai_browser", "relai_reset"].includes(name), destructiveHint: name === "relai_reset" }
  };
}
function stringProp() { return { type: "string" }; }
function boolProp() { return { type: "boolean" }; }
function numberProp(min, max) { return { type: "number", minimum: min, maximum: max }; }
function arrayProp(type, minItems, maxItems) { return { type: "array", items: { type }, minItems, maxItems }; }

module.exports = { toolSchemas, allToolSchemas, getToolSchemas, APPROVAL_GATES, callTool, workspaceList, workspaceInspect, workspaceTree, workspaceProfile };
