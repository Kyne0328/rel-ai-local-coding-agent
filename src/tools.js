const path = require("node:path");
const { readConfig, resolveWorkspace, publicConfigSummary } = require("./config");
const { collectTextFiles, readTextFileSafe, resolveSafePath } = require("./safety");
const { runProcess, summarizeCommand } = require("./process");
const { gitStatus, gitDiff, applyPatch, createBranch, commitAll, pushBranch, createPrWithGh } = require("./git");

const toolSchemas = [
  {
    name: "relai_config",
    title: "Rel.AI MCP Config Summary",
    description: "Return the active Rel.AI MCP config path, limits, configured workspace aliases, and test command keys. Does not reveal secrets.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "relai_workspace_tree",
    title: "Workspace Tree",
    description: "Return a safe, filtered file tree for a configured workspace alias. Generated/cache folders and sensitive paths are skipped.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        maxEntries: { type: "number", minimum: 1, maximum: 5000 }
      },
      required: ["workspace"],
      additionalProperties: false
    }
  },
  {
    name: "relai_read_files",
    title: "Read Workspace Files",
    description: "Read specific safe text files from a configured workspace. Rejects traversal, secret-looking paths, large files, binary files, and symlinks escaping the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        paths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 }
      },
      required: ["workspace", "paths"],
      additionalProperties: false
    }
  },
  {
    name: "relai_search",
    title: "Search Workspace Text",
    description: "Search safe text files in a workspace for a literal query string. This is intentionally simple and local-only.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        query: { type: "string" },
        maxMatches: { type: "number", minimum: 1, maximum: 200 }
      },
      required: ["workspace", "query"],
      additionalProperties: false
    }
  },
  {
    name: "relai_apply_patch",
    title: "Apply Unified Diff",
    description: "Validate and apply a unified diff with git apply. Use dryRun=true first for review/check-only mode.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        diff: { type: "string" },
        dryRun: { type: "boolean" }
      },
      required: ["workspace", "diff"],
      additionalProperties: false
    }
  },
  {
    name: "relai_run_test",
    title: "Run Allowlisted Test Command",
    description: "Run a locally configured test command by key. Arbitrary shell commands from the model are not accepted.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        testCommandKey: { type: "string" }
      },
      required: ["workspace", "testCommandKey"],
      additionalProperties: false
    }
  },
  {
    name: "relai_git_status",
    title: "Git Status",
    description: "Return git branch and short status for the workspace.",
    inputSchema: {
      type: "object",
      properties: { workspace: { type: "string" } },
      required: ["workspace"],
      additionalProperties: false
    }
  },
  {
    name: "relai_git_diff",
    title: "Git Diff",
    description: "Return the current unstaged or staged git diff for the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        staged: { type: "boolean" },
        path: { type: "string" }
      },
      required: ["workspace"],
      additionalProperties: false
    }
  },
  {
    name: "relai_create_branch",
    title: "Create Git Branch",
    description: "Create and switch to a feature branch. Refuses protected branch names.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        branchName: { type: "string" },
        fromRef: { type: "string" }
      },
      required: ["workspace", "branchName"],
      additionalProperties: false
    }
  },
  {
    name: "relai_commit_all",
    title: "Commit Workspace Changes",
    description: "Stage all workspace changes and commit them. Refuses commits directly on protected branches.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        message: { type: "string" }
      },
      required: ["workspace", "message"],
      additionalProperties: false
    }
  },
  {
    name: "relai_push_branch",
    title: "Push Feature Branch",
    description: "Push the current or provided feature branch to a remote. Refuses protected branches.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        remote: { type: "string" },
        branchName: { type: "string" }
      },
      required: ["workspace"],
      additionalProperties: false
    }
  },
  {
    name: "relai_create_pr",
    title: "Create Draft Pull Request via GitHub CLI",
    description: "Create a pull request with gh pr create. Disabled unless allowGitHubCli is true in config.json.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        base: { type: "string" },
        head: { type: "string" },
        draft: { type: "boolean" }
      },
      required: ["workspace", "title"],
      additionalProperties: false
    }
  }
];

async function callTool(name, args = {}) {
  const config = readConfig();
  switch (name) {
    case "relai_config":
      return ok(publicConfigSummary(config));
    case "relai_workspace_tree":
      return ok(workspaceTree(config, args));
    case "relai_read_files":
      return ok(readFiles(config, args));
    case "relai_search":
      return ok(searchWorkspace(config, args));
    case "relai_apply_patch":
      return ok(await withWorkspace(config, args.workspace, (workspace) => applyPatch(workspace, config, args.diff, { dryRun: Boolean(args.dryRun) })));
    case "relai_run_test":
      return ok(await runTest(config, args));
    case "relai_git_status":
      return ok(await withWorkspace(config, args.workspace, (workspace) => gitStatus(workspace, config)));
    case "relai_git_diff":
      return ok(await withWorkspace(config, args.workspace, (workspace) => {
        const safePath = args.path ? resolveSafePath(workspace.path, args.path).relativePath : undefined;
        return gitDiff(workspace, config, { staged: Boolean(args.staged), path: safePath });
      }));
    case "relai_create_branch":
      return ok(await withWorkspace(config, args.workspace, (workspace) => createBranch(workspace, config, args.branchName, { fromRef: args.fromRef })));
    case "relai_commit_all":
      return ok(await withWorkspace(config, args.workspace, (workspace) => commitAll(workspace, config, args.message)));
    case "relai_push_branch":
      return ok(await withWorkspace(config, args.workspace, (workspace) => pushBranch(workspace, config, args.remote || "origin", args.branchName || null)));
    case "relai_create_pr":
      return ok(await withWorkspace(config, args.workspace, (workspace) => createPrWithGh(workspace, config, args)));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function withWorkspace(config, alias, fn) {
  const workspace = resolveWorkspace(config, alias);
  return fn(workspace);
}

function workspaceTree(config, args) {
  const workspace = resolveWorkspace(config, args.workspace);
  const result = collectTextFiles(workspace.path, {
    maxEntries: args.maxEntries || config.maxTreeEntries,
    maxFileBytes: config.maxSearchFileBytes
  });
  return {
    workspace: workspace.alias,
    root: workspace.path,
    fileCount: result.files.length,
    files: result.files,
    skipped: result.skipped.slice(0, 200),
    truncated: result.truncated
  };
}

function readFiles(config, args) {
  const workspace = resolveWorkspace(config, args.workspace);
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (paths.length === 0) throw new Error("paths must contain at least one file.");
  const files = [];
  const skipped = [];
  for (const requestedPath of paths) {
    try {
      const safePath = resolveSafePath(workspace.path, requestedPath).relativePath;
      files.push({
        path: safePath,
        content: readTextFileSafe(workspace.path, safePath, config.maxReadFileBytes)
      });
    } catch (error) {
      skipped.push({ path: String(requestedPath), reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { workspace: workspace.alias, files, skipped };
}

function searchWorkspace(config, args) {
  const workspace = resolveWorkspace(config, args.workspace);
  const query = String(args.query || "");
  if (!query.trim()) throw new Error("query is required.");
  const maxMatches = Math.min(Math.max(Number(args.maxMatches || 50), 1), 200);
  const tree = collectTextFiles(workspace.path, {
    maxEntries: config.maxTreeEntries,
    maxFileBytes: config.maxSearchFileBytes
  });
  const matches = [];
  for (const relativePath of tree.files) {
    if (matches.length >= maxMatches) break;
    let content;
    try {
      content = readTextFileSafe(workspace.path, relativePath, config.maxSearchFileBytes);
    } catch (_error) {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length && matches.length < maxMatches; i += 1) {
      if (lines[i].includes(query)) {
        matches.push({ path: relativePath, line: i + 1, text: lines[i].slice(0, 500) });
      }
    }
  }
  return { workspace: workspace.alias, query, matches, searchedFiles: tree.files.length, skipped: tree.skipped.slice(0, 50) };
}

async function runTest(config, args) {
  const workspace = resolveWorkspace(config, args.workspace);
  const key = String(args.testCommandKey || "").trim();
  if (!key) throw new Error("testCommandKey is required.");
  const command = workspace.testCommands && workspace.testCommands[key];
  if (!command) {
    throw new Error(`Test command key '${key}' is not configured for workspace '${workspace.alias}'.`);
  }
  const result = await runProcess(command, [], { cwd: workspace.path, shell: true, commandString: command }, config);
  return { workspace: workspace.alias, testCommandKey: key, command, ...summarizeCommand(result) };
}

function ok(value) {
  return value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "ok")
    ? value
    : { ok: true, ...value };
}

module.exports = {
  toolSchemas,
  callTool
};
