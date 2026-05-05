const fs = require("node:fs");
const path = require("node:path");
const { readConfig, resolveWorkspace, publicConfigSummary } = require("./config");
const { collectTextFiles, readTextFileSafe, writeTextFileSafe, resolveSafePath, fileSha256 } = require("./safety");
const { runProcess, summarizeCommand } = require("./process");
const { logAudit, readAudit } = require("./audit");
const sessions = require("./sessions");
const {
  runGit,
  currentBranch,
  gitStatus,
  gitDiff,
  gitLog,
  gitShow,
  applyPatch,
  applyPatchAndRun,
  createBranch,
  switchBranch,
  commitAll,
  pushBranch,
  createPrWithGh,
  prChecksWithGh,
  runConfiguredCommand
} = require("./git");
const { createTaskWorktree, listWorktrees, removeTaskWorktree, workspaceFromSession } = require("./worktrees");
const { startCommandJob, jobStatus, listJobs, cancelJob } = require("./jobs");
const { runDocker } = require("./docker");
const { enforcePermission } = require("./permissions");
const pkg = require("../package.json");

const toolSchemas = [
  tool("relai_version", "Version Info", "Return rel-ai-mcp version, runtime, and server capabilities.", {}),
  tool("relai_config", "Rel.AI MCP Config Summary", "Return active config path, limits, workspace aliases, command keys, and safety switches. Does not reveal secrets.", {}),
  tool("relai_audit_tail", "Audit Log Tail", "Return recent rel-ai-mcp audit entries.", { limit: numberProp(1, 1000) }),

  tool("relai_task_start", "Start Coding Task Session", "Create a persistent Codex-like task session for planning, edits, tests, and PR tracking.", {
    workspace: stringProp(), goal: stringProp(), branch: stringProp()
  }, ["workspace", "goal"]),
  tool("relai_task_list", "List Coding Task Sessions", "List recent task sessions.", { limit: numberProp(1, 500) }),
  tool("relai_task_read", "Read Coding Task Session", "Read a task session with all recorded steps.", { sessionId: stringProp() }, ["sessionId"]),
  tool("relai_task_step", "Append Task Step", "Append a note, plan, test result, patch summary, or PR update to a task session.", {
    sessionId: stringProp(), type: stringProp(), title: stringProp(), details: stringProp(), data: objectProp()
  }, ["sessionId"]),
  tool("relai_task_update", "Update Task Session", "Update task session status, branch, or summary.", {
    sessionId: stringProp(), status: stringProp(), summary: stringProp(), branch: stringProp()
  }, ["sessionId"]),
  tool("relai_task_worktree_create", "Create Task Worktree", "Create an isolated git worktree for a task session and attach it to that session.", {
    sessionId: stringProp(), workspace: stringProp(), branchName: stringProp(), fromRef: stringProp()
  }, ["sessionId"]),
  tool("relai_task_worktree_remove", "Remove Task Worktree", "Remove a task session worktree after review/merge. Requires admin permission profile.", {
    sessionId: stringProp(), workspace: stringProp(), force: boolProp(), closeSession: boolProp()
  }, ["sessionId"]),
  tool("relai_worktree_list", "List Git Worktrees", "List git worktrees for a configured workspace.", {
    workspace: stringProp()
  }, ["workspace"]),

  tool("relai_workspace_tree", "Workspace Tree", "Return a safe filtered file tree for a configured workspace alias or attached task worktree. Generated/cache folders and sensitive paths are skipped.", {
    workspace: stringProp(), sessionId: stringProp(), maxEntries: numberProp(1, 20000)
  }, ["workspace"]),
  tool("relai_workspace_profile", "Workspace Profile", "Detect common stack manifests and summarize likely package manager/test surface.", {
    workspace: stringProp(), sessionId: stringProp()
  }, ["workspace"]),
  tool("relai_read_files", "Read Workspace Files", "Read specific safe text files from a workspace or attached task worktree. Rejects traversal, secret-looking paths, large files, binary files, and escaping symlinks.", {
    workspace: stringProp(), sessionId: stringProp(), paths: arrayProp("string", 1, 100), includeSha256: boolProp()
  }, ["workspace", "paths"]),
  tool("relai_write_file", "Write Workspace Text File", "Create or replace a safe text file in a workspace or task worktree. Supports expectedSha256 optimistic locking.", {
    workspace: stringProp(), sessionId: stringProp(), path: stringProp(), content: stringProp(), expectedSha256: stringProp()
  }, ["workspace", "path", "content"]),
  tool("relai_search", "Search Workspace Text", "Literal text search across safe text files.", {
    workspace: stringProp(), sessionId: stringProp(), query: stringProp(), maxMatches: numberProp(1, 500)
  }, ["workspace", "query"]),
  tool("relai_context_pack", "Build Focused Context Pack", "Build a focused coding context pack from explicit files plus search terms.", {
    workspace: stringProp(), sessionId: stringProp(), paths: arrayProp("string", 0, 100), searchTerms: arrayProp("string", 0, 20), maxSearchMatches: numberProp(1, 300), includeTree: boolProp()
  }, ["workspace"]),

  tool("relai_apply_patch", "Apply Unified Diff", "Validate and apply a unified diff with git apply. Use dryRun=true first for check-only mode.", {
    workspace: stringProp(), sessionId: stringProp(), diff: stringProp(), dryRun: boolProp()
  }, ["workspace", "diff"]),
  tool("relai_apply_patch_and_run", "Apply Patch And Run Tests", "Apply a patch, then run selected allowlisted tests. This is the main Codex-like build/verify tool.", {
    workspace: stringProp(), diff: stringProp(), dryRun: boolProp(), testCommandKeys: arrayProp("string", 0, 20), stopOnFailure: boolProp(), sessionId: stringProp()
  }, ["workspace", "diff"]),
  tool("relai_run_test", "Run Allowlisted Test Command", "Run a locally configured test command by key. Arbitrary shell commands from the model are not accepted here.", {
    workspace: stringProp(), testCommandKey: stringProp(), sessionId: stringProp()
  }, ["workspace", "testCommandKey"]),
  tool("relai_run_test_matrix", "Run Test Matrix", "Run several allowlisted test commands in order and return all outputs.", {
    workspace: stringProp(), testCommandKeys: arrayProp("string", 1, 30), stopOnFailure: boolProp(), sessionId: stringProp()
  }, ["workspace", "testCommandKeys"]),
  tool("relai_run_command", "Run Configured Dev Command", "Run an allowlisted dev command by key, or an arbitrary command only if explicitly enabled in config.", {
    workspace: stringProp(), commandKey: stringProp(), command: stringProp(), sessionId: stringProp()
  }, ["workspace"]),
  tool("relai_patch_test_loop", "Patch Test Loop", "Run a Codex-like patch/test cycle over one or more diffs, stopping at first patch or test failure.", {
    workspace: stringProp(), sessionId: stringProp(), patches: arrayProp("string", 1, 10), testCommandKeys: arrayProp("string", 0, 30), stopOnFailure: boolProp()
  }, ["patches"]),
  tool("relai_job_start_command", "Start Background Command Job", "Start an allowlisted test or dev command as a background job and return a job id for polling.", {
    workspace: stringProp(), sessionId: stringProp(), testCommandKey: stringProp(), commandKey: stringProp()
  }, ["workspace"]),
  tool("relai_job_status", "Read Background Job Status", "Read job metadata and stdout/stderr tails.", {
    jobId: stringProp(), tailBytes: numberProp(0, 200000)
  }, ["jobId"]),
  tool("relai_job_list", "List Background Jobs", "List recent background jobs.", {
    limit: numberProp(1, 500)
  }),
  tool("relai_job_cancel", "Cancel Background Job", "Send SIGTERM or SIGKILL to a live background job. Requires admin permission profile.", {
    jobId: stringProp(), force: boolProp()
  }, ["jobId"]),
  tool("relai_docker_run", "Run Command In Docker Sandbox", "Run an allowlisted test/dev command inside an allowlisted Docker image with the workspace mounted at /workspace.", {
    workspace: stringProp(), sessionId: stringProp(), image: stringProp(), testCommandKey: stringProp(), commandKey: stringProp(), network: stringProp()
  }, ["workspace"]),

  tool("relai_git_status", "Git Status", "Return git branch, cleanliness, and short status.", { workspace: stringProp(), sessionId: stringProp() }, ["workspace"]),
  tool("relai_git_diff", "Git Diff", "Return current unstaged or staged git diff.", {
    workspace: stringProp(), sessionId: stringProp(), staged: boolProp(), path: stringProp()
  }, ["workspace"]),
  tool("relai_git_log", "Git Log", "Return recent commits, optionally for one file.", {
    workspace: stringProp(), sessionId: stringProp(), limit: numberProp(1, 100), path: stringProp()
  }, ["workspace"]),
  tool("relai_git_show", "Git Show", "Show one commit/ref with stat and patch.", {
    workspace: stringProp(), sessionId: stringProp(), rev: stringProp()
  }, ["workspace", "rev"]),
  tool("relai_create_branch", "Create Git Branch", "Create and switch to a feature branch. Refuses protected branch names.", {
    workspace: stringProp(), branchName: stringProp(), fromRef: stringProp(), sessionId: stringProp()
  }, ["workspace", "branchName"]),
  tool("relai_switch_branch", "Switch Git Branch", "Switch to a branch. Protected branch switching is blocked unless destructive tools are explicitly enabled.", {
    workspace: stringProp(), branchName: stringProp()
  }, ["workspace", "branchName"]),
  tool("relai_commit_all", "Commit Workspace Changes", "Stage all workspace changes and commit them. Refuses commits directly on protected branches.", {
    workspace: stringProp(), message: stringProp(), sessionId: stringProp()
  }, ["workspace", "message"]),
  tool("relai_push_branch", "Push Feature Branch", "Push current or provided feature branch to an allowlisted remote. Refuses protected branches.", {
    workspace: stringProp(), remote: stringProp(), branchName: stringProp(), sessionId: stringProp()
  }, ["workspace"]),
  tool("relai_create_pr", "Create Draft Pull Request Via GitHub CLI", "Create a pull request with gh pr create. Disabled unless allowGitHubCli is true in config.json.", {
    workspace: stringProp(), title: stringProp(), body: stringProp(), base: stringProp(), head: stringProp(), draft: boolProp(), labels: arrayProp("string", 0, 20), reviewers: arrayProp("string", 0, 20), sessionId: stringProp()
  }, ["workspace", "title"]),
  tool("relai_pr_checks", "Pull Request Checks Via GitHub CLI", "Read PR checks through gh pr checks. Disabled unless allowGitHubCli is true.", {
    workspace: stringProp(), pr: stringProp(), sessionId: stringProp()
  }, ["workspace"]),
  tool("relai_pr_watch_checks", "Watch Pull Request Checks", "Poll gh pr checks several times and return the timeline. Use this to repair CI failures after pushing.", {
    workspace: stringProp(), pr: stringProp(), sessionId: stringProp(), attempts: numberProp(1, 20), intervalSeconds: numberProp(1, 120)
  }, ["workspace"]),
  tool("relai_git_reset_worktree", "Reset Task Worktree", "Hard reset and optionally clean a task worktree. Requires admin permission profile and a task session worktree unless destructive tools are enabled.", {
    workspace: stringProp(), sessionId: stringProp(), clean: boolProp()
  }, ["workspace"])
];

async function callTool(name, args = {}) {
  const config = readConfig();
  const started = Date.now();
  try {
    enforcePermission(config, name);
    const value = await dispatchTool(config, name, args || {});
    logAudit(config, { tool: name, ok: true, workspace: args && args.workspace, sessionId: args && args.sessionId, ms: Date.now() - started });
    return ok(value);
  } catch (error) {
    logAudit(config, { tool: name, ok: false, workspace: args && args.workspace, sessionId: args && args.sessionId, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function dispatchTool(config, name, args) {
  switch (name) {
    case "relai_version":
      return versionInfo();
    case "relai_config":
      return publicConfigSummary(config);
    case "relai_audit_tail":
      return readAudit(config, { limit: args.limit });

    case "relai_task_start":
      resolveWorkspace(config, args.workspace);
      return sessions.createSession(config, args);
    case "relai_task_list":
      return { sessions: sessions.listSessions(config, { limit: args.limit }) };
    case "relai_task_read":
      return sessions.readSession(config, args.sessionId);
    case "relai_task_step":
      return sessions.appendStep(config, args);
    case "relai_task_update":
      return sessions.updateSession(config, args);
    case "relai_task_worktree_create": {
      const session = sessions.readSession(config, args.sessionId);
      const base = resolveWorkspace(config, args.workspace || session.workspace);
      return createTaskWorktree(config, base, { ...args, workspace: base.alias });
    }
    case "relai_task_worktree_remove": {
      const session = sessions.readSession(config, args.sessionId);
      const base = resolveWorkspace(config, args.workspace || session.workspace);
      return removeTaskWorktree(config, base, args);
    }
    case "relai_worktree_list":
      return withWorkspace(config, args, (workspace) => listWorktrees(workspace, config));

    case "relai_workspace_tree":
      return workspaceTree(config, args);
    case "relai_workspace_profile":
      return workspaceProfile(config, args);
    case "relai_read_files":
      return readFiles(config, args);
    case "relai_write_file":
      return withWorkspace(config, args, (workspace) => writeTextFileSafe(workspace.path, args.path, args.content, { maxBytes: config.maxWriteFileBytes, expectedSha256: args.expectedSha256 }));
    case "relai_search":
      return searchWorkspace(config, args);
    case "relai_context_pack":
      return contextPack(config, args);

    case "relai_apply_patch":
      return withWorkspace(config, args, (workspace) => applyPatch(workspace, config, args.diff, { dryRun: Boolean(args.dryRun) }));
    case "relai_apply_patch_and_run":
      return recordMaybe(config, args, "patch_and_test", async (workspace) => applyPatchAndRun(workspace, config, args));
    case "relai_run_test":
      return recordMaybe(config, args, "test", async () => runTest(config, args));
    case "relai_run_test_matrix":
      return recordMaybe(config, args, "test_matrix", async () => runTestMatrix(config, args));
    case "relai_run_command":
      return recordMaybe(config, args, "command", async (workspace) => runConfiguredCommand(workspace, config, args));
    case "relai_patch_test_loop":
      return recordMaybe(config, args, "patch_test_loop", async (workspace) => patchTestLoop(workspace, config, args));
    case "relai_job_start_command":
      return withWorkspace(config, args, (workspace) => startCommandJob(config, workspace, args));
    case "relai_job_status":
      return jobStatus(config, args);
    case "relai_job_list":
      return { jobs: listJobs(config, { limit: args.limit }) };
    case "relai_job_cancel":
      return cancelJob(config, args);
    case "relai_docker_run":
      return recordMaybe(config, args, "docker", async (workspace) => runDocker(config, workspace, args));

    case "relai_git_status":
      return withWorkspace(config, args, (workspace) => gitStatus(workspace, config));
    case "relai_git_diff":
      return withWorkspace(config, args, (workspace) => {
        const safePath = args.path ? resolveSafePath(workspace.path, args.path).relativePath : undefined;
        return gitDiff(workspace, config, { staged: Boolean(args.staged), path: safePath });
      });
    case "relai_git_log":
      return withWorkspace(config, args, (workspace) => {
        const safePath = args.path ? resolveSafePath(workspace.path, args.path).relativePath : undefined;
        return gitLog(workspace, config, { limit: args.limit, path: safePath });
      });
    case "relai_git_show":
      return withWorkspace(config, args, (workspace) => gitShow(workspace, config, args.rev));
    case "relai_create_branch":
      return recordMaybe(config, args, "branch", async (workspace) => createBranch(workspace, config, args.branchName, { fromRef: args.fromRef }));
    case "relai_switch_branch":
      return withWorkspace(config, args.workspace, (workspace) => switchBranch(workspace, config, args.branchName));
    case "relai_commit_all":
      return recordMaybe(config, args, "commit", async (workspace) => commitAll(workspace, config, args.message));
    case "relai_push_branch":
      return recordMaybe(config, args, "push", async (workspace) => pushBranch(workspace, config, args.remote || "origin", args.branchName || null));
    case "relai_create_pr":
      return recordMaybe(config, args, "pr", async (workspace) => createPrWithGh(workspace, config, args));
    case "relai_pr_checks":
      return recordMaybe(config, args, "checks", async (workspace) => prChecksWithGh(workspace, config, args));
    case "relai_pr_watch_checks":
      return recordMaybe(config, args, "checks", async (workspace) => watchPrChecks(workspace, config, args));
    case "relai_git_reset_worktree":
      return recordMaybe(config, args, "reset", async (workspace) => resetWorktree(workspace, config, args));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function recordMaybe(config, args, type, fn) {
  const result = await withWorkspace(config, args, fn);
  if (args.sessionId) {
    sessions.appendStep(config, {
      sessionId: args.sessionId,
      type,
      title: titleFromType(type),
      details: JSON.stringify(result, null, 2),
      data: compactData(result)
    });
  }
  return result;
}

function titleFromType(type) {
  return ({ patch_and_test: "Applied patch and ran tests", test: "Ran test", test_matrix: "Ran test matrix", command: "Ran command", branch: "Created branch", commit: "Committed changes", push: "Pushed branch", pr: "Created PR", checks: "Read PR checks", docker: "Ran Docker command", patch_test_loop: "Ran patch/test loop", reset: "Reset worktree" })[type] || type;
}

function compactData(result) {
  if (!result || typeof result !== "object") return undefined;
  return { ok: Boolean(result.ok), message: result.message, branch: result.branch, touchedPaths: result.touchedPaths };
}

async function withWorkspace(config, requestOrAlias, fn) {
  const request = requestOrAlias && typeof requestOrAlias === "object" ? requestOrAlias : { workspace: requestOrAlias };
  let alias = request.workspace;
  if (!alias && request.sessionId) {
    alias = sessions.readSession(config, request.sessionId).workspace;
  }
  const base = resolveWorkspace(config, alias);
  const workspace = request.sessionId ? workspaceFromSession(config, base, request.sessionId) : base;
  return fn(workspace);
}

function versionInfo() {
  return {
    name: pkg.name,
    version: pkg.version,
    node: process.version,
    pid: process.pid,
    transports: ["stdio", "streamable-http", "sse"],
    toolCount: toolSchemas.length,
    capabilities: [
      "workspace tree/search/read/write",
      "task sessions",
      "audit log",
      "patch check/apply",
      "test matrix",
      "configured command runner",
      "git branch/diff/log/commit/push",
      "GitHub CLI PR creation/checks",
      "worktree-per-task isolation",
      "background job queue",
      "Docker sandbox hooks",
      "CI check watcher",
      "permission profiles",
      "task worktree reset/remove"
    ]
  };
}

function workspaceTree(config, args) {
  const workspace = resolveTargetWorkspace(config, args);
  const result = collectTextFiles(workspace.path, {
    maxEntries: args.maxEntries || config.maxTreeEntries,
    maxFileBytes: config.maxSearchFileBytes
  });
  return {
    workspace: workspace.alias,
    root: workspace.path,
    fileCount: result.files.length,
    files: result.files,
    skipped: result.skipped.slice(0, 300),
    truncated: result.truncated
  };
}

function workspaceProfile(config, args) {
  const workspace = resolveTargetWorkspace(config, args);
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
  return {
    workspace: workspace.alias,
    root: workspace.path,
    manifests: present,
    hints,
    configuredTestCommands: Object.keys(workspace.testCommands || {}).sort(),
    configuredCommands: Object.keys(workspace.commands || {}).sort()
  };
}

function readFiles(config, args) {
  const workspace = resolveTargetWorkspace(config, args);
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (paths.length === 0) throw new Error("paths must contain at least one file.");
  const files = [];
  const skipped = [];
  for (const requestedPath of paths) {
    try {
      const safePath = resolveSafePath(workspace.path, requestedPath).relativePath;
      files.push({
        path: safePath,
        ...(args.includeSha256 ? { sha256: fileSha256(workspace.path, safePath) } : {}),
        content: readTextFileSafe(workspace.path, safePath, config.maxReadFileBytes)
      });
    } catch (error) {
      skipped.push({ path: String(requestedPath), reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { workspace: workspace.alias, files, skipped };
}

function searchWorkspace(config, args) {
  const workspace = resolveTargetWorkspace(config, args);
  const query = String(args.query || "");
  if (!query.trim()) throw new Error("query is required.");
  const maxMatches = Math.min(Math.max(Number(args.maxMatches || 50), 1), 500);
  const tree = collectTextFiles(workspace.path, {
    maxEntries: config.maxTreeEntries,
    maxFileBytes: config.maxSearchFileBytes
  });
  const matches = [];
  for (const relativePath of tree.files) {
    if (matches.length >= maxMatches) break;
    let content;
    try { content = readTextFileSafe(workspace.path, relativePath, config.maxSearchFileBytes); } catch (_error) { continue; }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length && matches.length < maxMatches; i += 1) {
      if (lines[i].includes(query)) matches.push({ path: relativePath, line: i + 1, text: lines[i].slice(0, 500) });
    }
  }
  return { workspace: workspace.alias, query, matches, searchedFiles: tree.files.length, skipped: tree.skipped.slice(0, 50) };
}

function contextPack(config, args) {
  const workspace = resolveTargetWorkspace(config, args);
  const explicit = readFiles(config, { workspace: workspace.alias, paths: Array.isArray(args.paths) ? args.paths : [], includeSha256: true });
  const searches = [];
  for (const term of Array.isArray(args.searchTerms) ? args.searchTerms : []) {
    if (!String(term).trim()) continue;
    searches.push(searchWorkspace(config, { workspace: workspace.alias, query: String(term), maxMatches: args.maxSearchMatches || 50 }));
  }
  const tree = args.includeTree === false ? null : workspaceTree(config, { workspace: workspace.alias, maxEntries: Math.min(config.maxTreeEntries, 2000) });
  return { workspace: workspace.alias, tree, explicitFiles: explicit, searches };
}

async function runTest(config, args) {
  const workspace = resolveTargetWorkspace(config, args);
  const key = String(args.testCommandKey || "").trim();
  if (!key) throw new Error("testCommandKey is required.");
  const command = workspace.testCommands && workspace.testCommands[key];
  if (!command) throw new Error(`Test command key '${key}' is not configured for workspace '${workspace.alias}'.`);
  const result = await runProcess(command, [], { cwd: workspace.path, shell: true, commandString: command }, config);
  return { workspace: workspace.alias, testCommandKey: key, command, ...summarizeCommand(result) };
}

async function runTestMatrix(config, args) {
  const keys = Array.isArray(args.testCommandKeys) ? args.testCommandKeys : [];
  if (keys.length === 0) throw new Error("testCommandKeys must contain at least one key.");
  const results = [];
  for (const key of keys) {
    const result = await runTest(config, { workspace: args.workspace, testCommandKey: key });
    results.push(result);
    if (!result.ok && args.stopOnFailure !== false) break;
  }
  return { ok: results.every((item) => item.ok), workspace: args.workspace, results };
}

function resolveTargetWorkspace(config, args = {}) {
  let alias = args.workspace;
  if (!alias && args.sessionId) alias = sessions.readSession(config, args.sessionId).workspace;
  const base = resolveWorkspace(config, alias);
  return args.sessionId ? workspaceFromSession(config, base, args.sessionId) : base;
}

async function patchTestLoop(workspace, config, args = {}) {
  const patches = Array.isArray(args.patches) ? args.patches : [];
  if (patches.length === 0) throw new Error("patches must contain at least one diff.");
  const cycles = [];
  for (let i = 0; i < patches.length; i += 1) {
    const result = await applyPatchAndRun(workspace, config, {
      diff: patches[i],
      testCommandKeys: Array.isArray(args.testCommandKeys) ? args.testCommandKeys : [],
      stopOnFailure: args.stopOnFailure !== false
    });
    cycles.push({ index: i, ...result });
    if (!result.ok && args.stopOnFailure !== false) break;
  }
  return { ok: cycles.every((cycle) => cycle.ok), workspace: workspace.alias, cycles };
}

async function watchPrChecks(workspace, config, args = {}) {
  const attempts = Math.min(Math.max(Number(args.attempts || 3), 1), 20);
  const intervalMs = Math.min(Math.max(Number(args.intervalSeconds || 5), 1), 120) * 1000;
  const timeline = [];
  for (let i = 0; i < attempts; i += 1) {
    const result = await prChecksWithGh(workspace, config, args);
    timeline.push({ attempt: i + 1, ts: new Date().toISOString(), ...result });
    const text = `${result.result && result.result.stdout || ""}
${result.result && result.result.stderr || ""}`;
    if (result.ok && !/pending|queued|in_progress|waiting/i.test(text)) break;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ok: timeline.length > 0 && timeline[timeline.length - 1].ok, attempts: timeline.length, timeline };
}

async function resetWorktree(workspace, config, args = {}) {
  if (!workspace.taskSessionId && !workspace.allowDestructiveTools) {
    throw new Error("Hard reset is only allowed for attached task worktrees unless allowDestructiveTools is enabled.");
  }
  const reset = await runGit(["reset", "--hard"], workspace, config);
  const clean = args.clean ? await runGit(["clean", "-fd"], workspace, config) : null;
  return { ok: reset.exitCode === 0 && (!clean || clean.exitCode === 0), reset: summarizeCommand(reset), ...(clean ? { clean: summarizeCommand(clean) } : {}) };
}

function ok(value) {
  return value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "ok")
    ? value
    : { ok: true, ...value };
}

function tool(name, title, description, properties, required = []) {
  return { name, title, description, inputSchema: { type: "object", properties, required, additionalProperties: false } };
}
function stringProp() { return { type: "string" }; }
function boolProp() { return { type: "boolean" }; }
function numberProp(min, max) { return { type: "number", minimum: min, maximum: max }; }
function objectProp() { return { type: "object" }; }
function arrayProp(type, minItems, maxItems) { return { type: "array", items: { type }, minItems, maxItems }; }

module.exports = { toolSchemas, callTool };
