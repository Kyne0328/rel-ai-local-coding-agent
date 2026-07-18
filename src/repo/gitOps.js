const fs = require("node:fs");
const path = require("node:path");
const { runProcess, summarizeCommand } = require("../process");
const { resolveSafePath, isSecretPath } = require("../safety");
const { getStateDir } = require("../audit");

const DEFAULT_MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_AGGRESSIVE_MAX_PATCH_BYTES = 2 * 1024 * 1024;

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function truncateUtf8(text, maxBytes, label) {
  const value = String(text || "");
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  return Buffer.from(value, 'utf8').subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/u, '') + `\n[rel-ai-mcp ${label} truncated at ${maxBytes} bytes]`;
}

// ---- Patch configuration ----------------------------------------------------

function getPatchConfig(config) {
  return config.patch && typeof config.patch === "object" ? config.patch : {};
}

function patchNumber(config, key, fallback) {
  const value = getPatchConfig(config)[key];
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function patchFlag(config, key, fallback) {
  const value = getPatchConfig(config)[key];
  return value == null ? fallback : Boolean(value);
}

function assertPatchUpdateSafe(workspace, config, _args, patch) {
  if (!patch?.trim()) throw new Error("relai_edit requires non-empty updateText for patch-shaped edits.");
  const maxBytes = patchNumber(config, "maxUpdateBytes", DEFAULT_AGGRESSIVE_MAX_PATCH_BYTES);
  const bytes = Buffer.byteLength(patch, "utf8");
  if (bytes > maxBytes) throw new Error(`relai_edit refused ${bytes} byte patch; max is ${maxBytes}.`);
  if (!workspace?.path) throw new Error("relai_edit requires a valid workspace.");
}

// ---- Git status classification -----------------------------------------------

function readBaselineOwnership(workspace, config) {
  try {
    const { readSessionPolicy } = require("../policyResolver");
    const session = readSessionPolicy(config, workspace.alias);
    // Presence of a (non-expired) session file — not presence of a baselineDirty
    // key — is what marks ownership as knowable. A session that started against a
    // clean worktree has no baselineDirty entry, but it is still a real session:
    // everything dirty now is genuinely session-owned.
    if (!session || session.baselineCaptured !== true) return { baselineDirty: [], baselineSource: null };
    return {
      baselineDirty: Array.isArray(session.baselineDirty) ? session.baselineDirty : [],
      baselineSource: "session"
    };
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] session policy read:', error);
    return { baselineDirty: [], baselineSource: null };
  }
}

function statusGroups() {
  return {
    entries: [],
    sessionChanged: [],
    baselineChanged: [],
    untrackedSession: [],
    untrackedBaseline: [],
    unknownChanged: [],
    untrackedUnknown: []
  };
}

function statusFileFromLine(line) {
  const rawPath = line.slice(3).trim();
  const arrow = rawPath.indexOf(" -> ");
  return arrow >= 0 ? rawPath.slice(arrow + 4).trim() : rawPath;
}

function statusOwnerForFile(file, hasSession, baselineSet) {
  if (!hasSession) return "unknown";
  return baselineSet.has(file) ? "baseline" : "session";
}

function statusEntryFromLine(line, hasSession, baselineSet) {
  if (line.length < 3) return null;
  const indexStatus = line[0];
  const worktreeStatus = line[1];
  const file = statusFileFromLine(line);
  if (!file) return null;
  const owner = statusOwnerForFile(file, hasSession, baselineSet);
  return {
    path: file,
    indexStatus,
    worktreeStatus,
    owner,
    untracked: indexStatus === "?" && worktreeStatus === "?",
    raw: line
  };
}

function recordStatusEntry(groups, entry) {
  groups.entries.push(entry);
  const changedKey = `${entry.owner}Changed`;
  const untrackedKey = `untracked${entry.owner[0].toUpperCase()}${entry.owner.slice(1)}`;
  groups[changedKey].push(entry.path);
  if (entry.untracked) groups[untrackedKey].push(entry.path);
}

function classifyStatusOwnership(workspace, config, statusOutput) {
  const { baselineDirty, baselineSource } = readBaselineOwnership(workspace, config);
  const hasSession = baselineSource !== null;
  const baselineSet = new Set(baselineDirty);
  const groups = statusGroups();
  let branch = null;
  let aheadBehind = null;

  for (const line of String(statusOutput || "").split(/\r?\n/).filter(Boolean)) {
    if (line.startsWith("## ")) {
      const branchInfo = parseStatusBranchLine(line);
      branch = branchInfo.branch;
      aheadBehind = branchInfo.aheadBehind;
      continue;
    }
    const entry = statusEntryFromLine(line, hasSession, baselineSet);
    if (entry) recordStatusEntry(groups, entry);
  }

  return { branch, aheadBehind, hasSession, baselineSource, ...groups };
}

function parseStatusBranchLine(line) {
  const text = String(line || "").replace(/^##\s+/, "").trim();
  const aheadMatch = /ahead (\d+)/.exec(text);
  const behindMatch = /behind (\d+)/.exec(text);
  const branchPart = text.split("...")[0].trim();
  return {
    branch: branchPart || null,
    aheadBehind: aheadMatch || behindMatch ? {
      ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
      behind: behindMatch ? Number(behindMatch[1]) : 0
    } : null
  };
}

// ---- Git operation private helpers -------------------------------------------

async function ensureGitRepo(workspace, config) {
  const result = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], { cwd: workspace.path, timeout: 30000 }, config);
  if (result.exitCode !== 0 || !String(result.stdout || "").trim().startsWith("true")) throw new Error(`Workspace '${workspace.alias}' is not a git work tree.`);
}

async function gitStatusShort(workspace, config) {
  const result = await runProcess("git", ["status", "--short"], { cwd: workspace.path, timeout: 30000 }, config);
  if (result.exitCode !== 0) throw new Error(`git status failed for ${workspace.alias}: ${result.stderr || result.stdout || result.exitCode}`);
  return String(result.stdout || "");
}

async function requireCleanGitIfConfigured(workspace, config, args) {
  const required = args.requireCleanGit == null ? patchFlag(config, "requireCleanGit", false) : Boolean(args.requireCleanGit);
  if (!required) return;
  const status = await gitStatusShort(workspace, config);
  if (status.trim()) throw new Error(`Workspace '${workspace.alias}' is not clean.\n${status}`);
}

function shouldMakePatchBackup(config, args) {
  return args.backup == null ? patchFlag(config, "backup", true) : Boolean(args.backup);
}

async function makePatchBackup(workspace, config, operationId, label) {
  const status = await gitStatusShort(workspace, config);
  if (!status.trim()) return { type: "none", reason: "workspace clean" };
  const message = `rel-ai-mcp ${label} backup ${operationId}`;
  // Snapshot tracked changes WITHOUT disturbing the working tree: `stash create`
  // builds a stash commit but leaves the tree intact, then `stash store` records it
  // in the stash list for manual recovery. The previous `stash push --include-untracked`
  // moved changes away — which deleted an untracked patch/overlay target before apply,
  // so a no-op patch on a newly-created file failed with "No such file or directory".
  const created = await runProcess("git", ["stash", "create", message], { cwd: workspace.path, timeout: 120000 }, config);
  if (created.exitCode !== 0) return { type: "git-stash", message, ok: false, ...summarizeCommand(created) };
  const sha = String(created.stdout || "").trim();
  if (!sha) return { type: "none", reason: "no tracked changes to back up" };
  const stored = await runProcess("git", ["stash", "store", "-m", message, sha], { cwd: workspace.path, timeout: 120000 }, config);
  return { type: "git-stash", message, sha, ok: stored.exitCode === 0, ...summarizeCommand(stored) };
}

function tempStateDir(config, workspace, operationId, prefix) {
  const safeAlias = String(workspace.alias || "workspace").replace(/[^A-Za-z0-9_.-]/g, "_");
  const base = path.join(getStateDir(config), "fast", safeAlias);
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  return fs.mkdtempSync(path.join(base, `${prefix}-${operationId}-`));
}

function tempStatePath(config, workspace, operationId, ext) {
  const dir = tempStateDir(config, workspace, operationId, "payload");
  return path.join(dir, `payload${ext}`);
}

function validatePatchPaths(workspace, patch) {
  const paths = [];
  const seen = new Set();
  for (const line of String(patch || "").split(/\r?\n/)) {
    let value = null;
    if (line.startsWith("+++ b/")) value = line.slice(6);
    else if (line.startsWith("--- a/")) value = line.slice(6);
    else if (line.startsWith("rename from ")) value = line.slice("rename from ".length);
    else if (line.startsWith("rename to ")) value = line.slice("rename to ".length);
    if (!value || value === "/dev/null") continue;
    const safe = resolveSafePath(workspace.path, value);
    if (!seen.has(safe.relativePath)) {
      seen.add(safe.relativePath);
      paths.push(safe.relativePath);
    }
  }
  if (paths.length === 0) throw new Error("Patch did not contain any valid workspace file paths. Expected unified diff format with headers like '--- a/path/to/file' and '+++ b/path/to/file'. Example: use 'git diff' output or generate a patch with 'git format-patch'.");
  return paths;
}

// Enforce the workspace's allowedRemotes allowlist. Beyond honoring a configured
// setting, this blocks git's command-executing transports (ext::, fd::, a remote
// whose URL starts with a shell command) by refusing any remote name not on the list.
function allowedRemoteSet(workspace) {
  const list = Array.isArray(workspace.allowedRemotes) && workspace.allowedRemotes.length
    ? workspace.allowedRemotes
    : ["origin"];
  return new Set(list.map((item) => String(item).trim()).filter(Boolean));
}

function assertRemoteAllowed(workspace, remote) {
  const name = String(remote || "").trim();
  const allowed = allowedRemoteSet(workspace);
  if (!name || !allowed.has(name)) {
    throw new Error(`Remote '${name || "(empty)"}' is not in this workspace's allowedRemotes (${[...allowed].join(", ")}). Add it to the workspace config to use it.`);
  }
  return name;
}

async function currentGitBranch(workspace, config) {
  const branch = await runProcess("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: workspace.path, timeout: 30000 }, config);
  if (branch.exitCode !== 0) return "";
  return String(branch.stdout || "").trim();
}

function buildPrBodyFromDiff(diffText) {
  const changedFiles = [];
  for (const line of String(diffText || "").split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) changedFiles.push(line.slice(6));
  }
  const unique = [...new Set(changedFiles)];
  return [
    "## Summary",
    "",
    `- Changes prepared from \`${unique.length}\` file(s)`,
    "",
    "## Files",
    "",
    ...unique.slice(0, 50).map((item) => `- \`${item}\``)
  ].join("\n");
}

// ---- Git operations ----------------------------------------------------------

async function relaiGitStatus(workspace, config, args = {}) {
  const maxBytes = clampNumber(args.maxBytes, 1000, 5 * 1024 * 1024, DEFAULT_MAX_GIT_OUTPUT_BYTES);
  const status = await runProcess("git", ["status", "--short", "--branch"], { cwd: workspace.path, timeout: 30000 }, config);
  const ownership = classifyStatusOwnership(workspace, config, status.stdout || "");
  return {
    ok: status.exitCode === 0,
    workspace: workspace.alias,
    branch: ownership.branch,
    aheadBehind: ownership.aheadBehind,
    status: truncateUtf8(status.stdout || "", maxBytes, "git status"),
    statusEntries: ownership.entries,
    sessionChangedFiles: ownership.sessionChanged,
    baselineChangedFiles: ownership.baselineChanged,
    untrackedSessionFiles: ownership.untrackedSession,
    untrackedBaselineFiles: ownership.untrackedBaseline,
    ...(ownership.baselineSource ? { baselineSource: ownership.baselineSource } : {}),
    ...(status.stderr ? { stderr: truncateUtf8(status.stderr, maxBytes, "git status stderr") } : {})
  };
}

async function relaiGitCommit(workspace, config, args = {}) {
  await ensureGitRepo(workspace, config);
  const message = String(args.message || "").trim();
  if (!message) throw new Error("relai_git_commit requires a non-empty commit message.");
  const dryRun = Boolean(args.dryRun);
  const paths = Array.isArray(args.paths) ? args.paths.map((item) => resolveSafePath(workspace.path, item).relativePath) : [];
  const addAll = paths.length === 0 && args.addAll !== false;
  const statusBefore = await relaiGitStatus(workspace, config, { maxBytes: args.maxBytes });
  if (dryRun) {
    return {
      ok: true,
      workspace: workspace.alias,
      dryRun: true,
      message,
      addAll,
      paths,
      status: statusBefore
    };
  }
  const indexTree = await runProcess("git", ["write-tree"], { cwd: workspace.path, timeout: 60000 }, config);
  if (indexTree.exitCode !== 0) throw new Error(`Could not snapshot the Git index before staging: ${indexTree.stderr || indexTree.stdout || indexTree.exitCode}`);
  const restoreIndex = async () => {
    const tree = String(indexTree.stdout || "").trim();
    if (!tree) return null;
    return runProcess("git", ["read-tree", tree], { cwd: workspace.path, timeout: 60000 }, config);
  };
  if (paths.length > 0) {
    const add = await runProcess("git", ["add", "--", ...paths], { cwd: workspace.path, timeout: 60000 }, config);
    if (add.exitCode !== 0) return { ok: false, workspace: workspace.alias, message, addAll, paths, add: summarizeCommand(add) };
  } else if (addAll) {
    const add = await runProcess("git", ["add", "-A"], { cwd: workspace.path, timeout: 60000 }, config);
    if (add.exitCode !== 0) return { ok: false, workspace: workspace.alias, message, addAll, add: summarizeCommand(add) };
  }
  // `git add -A` stages anything not gitignored, including files the read/write
  // tools refuse to touch (.env, keys, credentials). Refuse to commit those unless
  // the caller explicitly opts in after review.
  if (args.allowSecretPaths !== true) {
    const staged = await runProcess("git", ["diff", "--cached", "--name-only"], { cwd: workspace.path, timeout: 60000 }, config);
    const secretStaged = String(staged.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter((file) => file && isSecretPath(file));
    if (secretStaged.length > 0) {
      const indexRestore = await restoreIndex();
      return {
        ok: false,
        workspace: workspace.alias,
        message,
        addAll,
        paths,
        secretStagedFiles: secretStaged,
        indexRestored: indexRestore?.exitCode === 0,
        error: `Refusing to commit staged files that look like secrets: ${secretStaged.join(", ")}. The pre-operation index was restored. Pass allowSecretPaths: true only after reviewing those files.`
      };
    }
  }
  const commit = await runProcess("git", ["commit", "-m", message], { cwd: workspace.path, timeout: clampNumber(args.timeoutMs, 1000, 86400000, 120000) }, config);
  const statusAfter = await relaiGitStatus(workspace, config, { maxBytes: args.maxBytes });
  return { ok: commit.exitCode === 0, workspace: workspace.alias, message, addAll, paths, commit: summarizeCommand(commit), statusBefore, statusAfter };
}

async function relaiGitPush(workspace, config, args = {}) {
  await ensureGitRepo(workspace, config);
  const remote = assertRemoteAllowed(workspace, String(args.remote || "origin").trim());
  const branch = String(args.branch || await currentGitBranch(workspace, config)).trim();
  if (!branch) throw new Error("relai_git_push could not determine the branch to push.");
  const dryRun = Boolean(args.dryRun);
  const setUpstream = Boolean(args.setUpstream);
  const pushArgs = ["push", ...(dryRun ? ["--dry-run"] : []), ...(setUpstream ? ["--set-upstream"] : []), remote, branch];
  const push = await runProcess("git", pushArgs, { cwd: workspace.path, timeout: clampNumber(args.timeoutMs, 1000, 86400000, 120000) }, config);
  return { ok: push.exitCode === 0, workspace: workspace.alias, remote, branch, dryRun, setUpstream, push: summarizeCommand(push) };
}

async function relaiGitCreatePr(workspace, config, args = {}) {
  await ensureGitRepo(workspace, config);
  const head = String(args.head || await currentGitBranch(workspace, config)).trim();
  const base = String(args.base || workspace.defaultBaseBranch || "main").trim();
  const title = String(args.title || "").trim();
  const body = String(args.body || "").trim();
  const diff = await runProcess("git", ["diff", `${base}...${head}`], { cwd: workspace.path, timeout: 60000 }, { ...config, maxOutputBytes: 2 * 1024 * 1024 });
  const diffText = diff.stdout || "";
  const changedFiles = [...new Set(String(diffText).split(/\r?\n/).filter((line) => line.startsWith("+++ b/")).map((line) => line.slice(6)))];
  const emptyDiff = diff.exitCode === 0 && changedFiles.length === 0 && !diffText.trim();
  return {
    ok: diff.exitCode === 0 && !emptyDiff,
    workspace: workspace.alias,
    base,
    head,
    title: title || `Merge ${head} into ${base}`,
    body: body || buildPrBodyFromDiff(diffText),
    changedFiles,
    changedFileCount: changedFiles.length,
    emptyDiff,
    ...(emptyDiff ? { warning: `No diff between ${base} and ${head}; refusing to draft an empty pull request.` } : {}),
    diff: summarizeCommand(diff)
  };
}

module.exports = {
  relaiGitStatus,
  relaiGitCommit,
  relaiGitPush,
  relaiGitCreatePr,
  classifyStatusOwnership,
  getPatchConfig,
  patchNumber,
  patchFlag,
  assertPatchUpdateSafe,
  ensureGitRepo,
  requireCleanGitIfConfigured,
  shouldMakePatchBackup,
  makePatchBackup,
  tempStateDir,
  tempStatePath,
  validatePatchPaths,
  clampNumber,
  truncateUtf8,
  DEFAULT_AGGRESSIVE_MAX_PATCH_BYTES
};
