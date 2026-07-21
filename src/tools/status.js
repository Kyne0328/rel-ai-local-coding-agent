const fs = require("node:fs");
const path = require("node:path");
const { resolveWorkspace } = require("../config");
const { collectTextFiles, collectOptionsFromWorkspace, resolveSafePath } = require("../safety");
const { discoverCommands, staleCommandKeys: staleCommandKeyList } = require("../commandDiscovery");
const { summarizeOperations } = require("../journal");
const { resolvePolicy } = require("../policyResolver");
const { getVersion } = require("../version");
const { debugSwallow } = require("./session");
const { TOOL_NAMES, getToolGroups } = require("./schema");

// Locale-aware sort of an object's keys. Sonar (S2871) flags Array.sort() on strings
// without an explicit comparator, so route key sorting through one helper.
function sortedKeys(obj) {
  return Object.keys(obj || {}).sort((a, b) => a.localeCompare(b));
}

function relaiStatus(config, args = {}) {
  const packageJson = safeReadPackageJson();
  const scripts = packageJson.scripts || {};
  const ci = ciScriptStatus(scripts);
  const workspaceAliases = sortedKeys(config.workspaces);
  let selectedWorkspace = null;
  if (args.workspace) {
    try {
      const workspace = resolveWorkspace(config, args.workspace);
      const discovered = discoverCommands(workspace.path);
      const commandKeys = sortedKeys(workspace.commands);
      const testCommandKeys = sortedKeys(workspace.testCommands);
      const staleCommandKeys = staleCommandKeyList(workspace.commands || {}, discovered);
      const staleTestCommandKeys = staleCommandKeyList(workspace.testCommands || {}, discovered);
      selectedWorkspace = {
        alias: workspace.alias,
        root: workspace.path,
        commandKeys,
        testCommandKeys,
        ...(staleCommandKeys.length > 0 ? { staleCommandKeys } : {}),
        ...(staleTestCommandKeys.length > 0 ? { staleTestCommandKeys } : {}),
        policy: resolvePolicy(workspace, config)
      };
    } catch (error) {
      selectedWorkspace = { alias: String(args.workspace), error: error instanceof Error ? error.message : String(error) };
    }
  }
  return {
    ok: true,
    version: getVersion(),
    tools: TOOL_NAMES,
    toolGroups: getToolGroups(),
    scripts: sortedKeys(scripts),
    ci,
    workspace: selectedWorkspace,
    workspaceCount: workspaceAliases.length,
    workspaceAliases
  };
}

function ciScriptStatus(scripts) {
  const nodePath = require("node:path");
  // Resolve workflows relative to THIS server's package root (__dirname/..), not
  // process.cwd(). When launched from the packaged launcher, cwd is the launcher
  // directory, so a cwd-based scan found no workflows and silently reported ok:true.
  // This keeps the CI scan on the same basis as safeReadPackageJson (the scripts it
  // is checked against).
  const projectRoot = nodePath.join(__dirname, "..");
  const workflowDir = nodePath.join(projectRoot, ".github", "workflows");
  const missing = [];
  const files = [];
  if (fs.existsSync(workflowDir)) collectWorkflowFiles(workflowDir, files);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/npm\s+run\s+([A-Za-z0-9:_-]+)/g)) {
      if (!scripts[match[1]]) missing.push({ file: file.replace(projectRoot + nodePath.sep, ""), script: match[1] });
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
  const path = require("node:path");
  // Read this server's OWN package.json (stable relative to the module) first.
  // process.cwd() is unreliable — when launched from the packaged launcher it is
  // the launcher's directory, which yields version:"" and the wrong scripts.
  const candidates = [
    path.join(__dirname, "..", "package.json"),
    path.join(process.cwd(), "package.json")
  ];
  for (const file of candidates) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      // Missing/invalid candidate — fall through to the next path.
      debugSwallow("read-package-json", error);
    }
  }
  return {};
}

function workspaceList(config) {
  const workspaces = Object.entries(config.workspaces || {}).map(([alias, item]) => ({
    alias,
    path: item.path,
    repoSlug: item.repoSlug || "",
    testCommandKeys: sortedKeys(item.testCommands),
    commandKeys: sortedKeys(item.commands),
    protectedBranches: Array.isArray(item.protectedBranches) ? item.protectedBranches : [],
    context: item.context || {}
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
      requiredFlow: TOOL_NAMES,
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
    } catch (error) {
      // Unsafe/unresolvable manifest path — treat as absent.
      debugSwallow("resolve-manifest", error);
    }
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
    configuredTestCommands: sortedKeys(workspace.testCommands),
    configuredCommands: sortedKeys(workspace.commands),
    discoveredCommands: discovered,
    discoveredCommandCount: Object.keys(discovered).length
  };
}

module.exports = {
  relaiStatus,
  workspaceList,
  workspaceInspect,
  workspaceTree,
  workspaceProfile
};
