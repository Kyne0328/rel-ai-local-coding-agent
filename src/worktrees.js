const fs = require("node:fs");
const path = require("node:path");
const { runProcess, summarizeCommand } = require("./process");
const { validateBranchName, runGit } = require("./git");
const { readSession, updateSession, appendStep } = require("./sessions");
const { isPathInside } = require("./safety");

function getWorktreeRoot(config, workspace) {
  const root = workspace.worktreeRoot || config.worktreeRoot || path.join(config.stateDir, "worktrees");
  const base = path.resolve(String(root));
  return path.join(base, workspace.alias);
}

function safeWorktreeName(sessionId, branchName) {
  const suffix = String(branchName || "task").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "task";
  return `${String(sessionId).replace(/[^A-Za-z0-9._-]+/g, "-")}-${suffix}`;
}

async function createTaskWorktree(config, baseWorkspace, args = {}) {
  const session = readSession(config, args.sessionId);
  const branch = validateBranchName(args.branchName || session.branch || `relai/${session.id}`);
  const fromRef = args.fromRef ? String(args.fromRef) : (baseWorkspace.defaultBaseBranch || "main");
  const root = getWorktreeRoot(config, baseWorkspace);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const worktreePath = path.join(root, safeWorktreeName(session.id, branch));
  if (fs.existsSync(worktreePath)) throw new Error(`Worktree path already exists: ${worktreePath}`);
  const result = await runGit(["worktree", "add", "-b", branch, worktreePath, fromRef], baseWorkspace, config);
  const payload = {
    ok: result.exitCode === 0,
    sessionId: session.id,
    workspace: baseWorkspace.alias,
    branch,
    fromRef,
    worktreePath,
    result: summarizeCommand(result)
  };
  if (payload.ok) {
    updateSession(config, { sessionId: session.id, branch, worktreePath, worktreeBaseWorkspace: baseWorkspace.alias, worktreeCreatedAt: new Date().toISOString() });
    appendStep(config, { sessionId: session.id, type: "worktree", title: "Created task worktree", details: JSON.stringify(payload, null, 2), data: { ok: true, branch, worktreePath } });
  }
  return payload;
}

async function listWorktrees(workspace, config) {
  const result = await runGit(["worktree", "list", "--porcelain"], workspace, config);
  const items = [];
  let current = null;
  for (const line of String(result.stdout || "").split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) items.push(current);
      current = { path: line.slice("worktree ".length) };
    } else if (current && line.startsWith("HEAD ")) current.head = line.slice(5);
    else if (current && line.startsWith("branch ")) current.branch = line.slice("branch refs/heads/".length);
    else if (current && line === "detached") current.detached = true;
    else if (current && line === "bare") current.bare = true;
  }
  if (current) items.push(current);
  return { ok: result.exitCode === 0, worktrees: items, result: summarizeCommand(result) };
}

async function removeTaskWorktree(config, baseWorkspace, args = {}) {
  const session = readSession(config, args.sessionId);
  const worktreePath = session.worktreePath || args.worktreePath;
  if (!worktreePath) throw new Error("No worktree path is attached to this session.");
  const root = getWorktreeRoot(config, baseWorkspace);
  const resolved = path.resolve(worktreePath);
  if (!isPathInside(resolved, path.resolve(root))) {
    throw new Error(`Refusing to remove worktree outside configured worktreeRoot: ${resolved}`);
  }
  const gitArgs = ["worktree", "remove"];
  if (args.force === true) gitArgs.push("--force");
  gitArgs.push(resolved);
  const result = await runGit(gitArgs, baseWorkspace, config);
  const payload = { ok: result.exitCode === 0, sessionId: session.id, worktreePath: resolved, result: summarizeCommand(result) };
  if (payload.ok) {
    updateSession(config, { sessionId: session.id, status: args.closeSession ? "closed" : session.status, worktreeRemovedAt: new Date().toISOString(), summary: session.summary || "Task worktree removed." });
    appendStep(config, { sessionId: session.id, type: "worktree", title: "Removed task worktree", details: JSON.stringify(payload, null, 2), data: { ok: true, worktreePath: resolved } });
  }
  return payload;
}

function workspaceFromSession(config, baseWorkspace, sessionId) {
  const session = readSession(config, sessionId);
  if (!session.worktreePath) return baseWorkspace;
  const realPath = fs.realpathSync(session.worktreePath);
  return {
    ...baseWorkspace,
    alias: `${baseWorkspace.alias}:${session.id}`,
    baseAlias: baseWorkspace.alias,
    path: realPath,
    taskSessionId: session.id,
    worktreePath: realPath
  };
}

module.exports = {
  createTaskWorktree,
  listWorktrees,
  removeTaskWorktree,
  workspaceFromSession,
  getWorktreeRoot
};
