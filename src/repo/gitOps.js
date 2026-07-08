const fs = require("node:fs");
const path = require("node:path");
const { runProcess, summarizeCommand } = require("../process");
const { resolveSafePath, isSecretPath } = require("../safety");
const { getStateDir } = require("../audit");

const DEFAULT_MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_AGGRESSIVE_MAX_PATCH_BYTES = 2 * 1024 * 1024;
const DEFAULT_AGGRESSIVE_MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function truncateUtf8(text, maxBytes, label) {
  const value = String(text || "");
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  return value.slice(0, maxBytes) + `\n[rel-ai-mcp ${label} truncated at ${maxBytes} bytes]`;
}

// ---- Prepared-workflow config helpers ----------------------------------------

function getPreparedConfig(config) {
  const wf = config.workflow && typeof config.workflow === "object" ? config.workflow : {};
  return wf.prepared && typeof wf.prepared === "object" ? wf.prepared : {};
}

function preparedNumber(config, key, fallback) {
  const value = getPreparedConfig(config)[key];
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function preparedFlag(config, key, fallback) {
  const value = getPreparedConfig(config)[key];
  return value == null ? fallback : Boolean(value);
}

function workflowSummary(config) {
  const { getWorkflowConfig } = require("../config");
  const wf = getWorkflowConfig(config);
  return {
    mode: wf.mode,
    prepared: {
      requireCleanGit: preparedFlag(config, "requireCleanGit", false),
      backup: preparedFlag(config, "backup", true),
      clearMissingDefault: preparedFlag(config, "clearMissingDefault", false),
      maxUpdateBytes: preparedNumber(config, "maxUpdateBytes", DEFAULT_AGGRESSIVE_MAX_PATCH_BYTES),
      maxBundleBytes: preparedNumber(config, "maxBundleBytes", DEFAULT_AGGRESSIVE_MAX_ARCHIVE_BYTES)
    }
  };
}

function recommendedFlowForConfig(config) {
  const { isPreparedWorkflow } = require("../config");
  // Only recommend tools that exist on the public connector surface — steering
  // ChatGPT toward a hidden tool just produces "not available" errors.
  const base = ["relai_read", "relai_edit", "relai_replace", "relai_write", "relai_tidy_plan", "relai_tidy_run", "relai_run_checks", "relai_diff", "relai_restore_changes"];
  if (!isPreparedWorkflow(config)) return base;
  return ["relai_repo_snapshot", "relai_read", "relai_edit", "relai_apply_bundle", "relai_package_snapshot", "relai_tidy_plan", "relai_tidy_run", "relai_run_checks", "relai_diff", "relai_restore_changes"];
}

function assertPreparedUpdateSafe(workspace, config, args, patch) {
  if (!patch?.trim()) throw new Error("relai_apply_update requires patch or diff text.");
  const maxBytes = preparedNumber(config, "maxUpdateBytes", DEFAULT_AGGRESSIVE_MAX_PATCH_BYTES);
  const bytes = Buffer.byteLength(patch, "utf8");
  if (bytes > maxBytes) throw new Error(`relai_apply_update refused ${bytes} byte patch; max is ${maxBytes}.`);
  if (!workspace?.path) throw new Error("relai_apply_update requires a valid workspace.");
}

function assertPreparedBundleSafe(workspace, config, args, archivePath, stat) {
  if (!archivePath) throw new Error("relai_apply_bundle requires bundlePath pointing to a local zip archive on the MCP host.");
  if (!stat?.isFile()) throw new Error(`Archive path is not a file: ${archivePath}`);
  const maxBytes = preparedNumber(config, "maxBundleBytes", DEFAULT_AGGRESSIVE_MAX_ARCHIVE_BYTES);
  if (stat.size > maxBytes) throw new Error(`relai_apply_bundle refused ${stat.size} byte archive; max is ${maxBytes}.`);
  if (!workspace?.path) throw new Error("relai_apply_bundle requires a valid workspace.");
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
    if (!session) return { baselineDirty: [], baselineSource: null };
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
  const required = args.requireCleanGit == null ? preparedFlag(config, "requireCleanGit", false) : Boolean(args.requireCleanGit);
  if (!required) return;
  const status = await gitStatusShort(workspace, config);
  if (status.trim()) throw new Error(`Workspace '${workspace.alias}' is not clean.\n${status}`);
}

function shouldMakePreparedBackup(config, args) {
  return args.backup == null ? preparedFlag(config, "backup", true) : Boolean(args.backup);
}

async function makePreparedBackup(workspace, config, operationId, label) {
  const status = await gitStatusShort(workspace, config);
  if (!status.trim()) return { type: "none", reason: "workspace clean" };
  const message = `rel-ai-mcp prepared ${label} backup ${operationId}`;
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

async function listGitRemotes(workspace, config) {
  const remotes = await runProcess("git", ["remote"], { cwd: workspace.path, timeout: 30000 }, config);
  if (remotes.exitCode !== 0) throw new Error(`git remote failed for ${workspace.alias}: ${remotes.stderr || remotes.stdout || remotes.exitCode}`);
  return String(remotes.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function currentGitBranch(workspace, config) {
  const branch = await runProcess("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: workspace.path, timeout: 30000 }, config);
  if (branch.exitCode !== 0) return "";
  return String(branch.stdout || "").trim();
}

function compareMergeCandidates(left, right) {
  const staleLeft = left.staleDays == null ? -1 : left.staleDays;
  const staleRight = right.staleDays == null ? -1 : right.staleDays;
  if (left.risk.length !== right.risk.length) return left.risk.length - right.risk.length;
  if (left.recommendedOrderGroup !== right.recommendedOrderGroup) return left.recommendedOrderGroup.localeCompare(right.recommendedOrderGroup);
  return staleLeft - staleRight;
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

async function relaiGitFetch(workspace, config, args = {}) {
  await ensureGitRepo(workspace, config);
  const allowed = allowedRemoteSet(workspace);
  const remote = String(args.remote || "").trim();
  if (remote) assertRemoteAllowed(workspace, remote);
  // No explicit remote: fetch only configured remotes that are also on the allowlist.
  const configuredRemotes = remote ? null : await listGitRemotes(workspace, config);
  const remotes = remote ? [remote] : configuredRemotes.filter((item) => allowed.has(item));
  const prune = args.prune !== false;
  if (remotes.length === 0) {
    // Nothing matched the allowlist — say so instead of reporting a hollow ok:true.
    return {
      ok: false,
      workspace: workspace.alias,
      remotes,
      prune,
      results: [],
      error: `No configured remote matches allowedRemotes (${[...allowed].join(", ")}). Configured remotes: ${(configuredRemotes || []).join(", ") || "(none)"}.`
    };
  }
  const results = [];
  for (const item of remotes) {
    const fetchArgs = ["fetch", item, ...(prune ? ["--prune"] : [])];
    const result = await runProcess("git", fetchArgs, { cwd: workspace.path, timeout: clampNumber(args.timeoutMs, 1000, 86400000, 120000) }, config);
    results.push({ remote: item, ...summarizeCommand(result) });
    if (result.exitCode !== 0 && args.stopOnFailure !== false) break;
  }
  return { ok: results.every((item) => item.ok), workspace: workspace.alias, remotes, prune, results };
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
      return {
        ok: false,
        workspace: workspace.alias,
        message,
        addAll,
        paths,
        secretStagedFiles: secretStaged,
        error: `Refusing to commit staged files that look like secrets: ${secretStaged.join(", ")}. Unstage them (git restore --staged <file>) or pass allowSecretPaths: true after reviewing.`
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

function protectedBranchList(workspace) {
  return Array.isArray(workspace.protectedBranches) ? workspace.protectedBranches : ["main", "master"];
}

function assertMergeTargetAllowed(workspace, target, args) {
  if (!protectedBranchList(workspace).includes(target) || args.allowProtected === true) return;
  throw new Error(`Target branch '${target}' is protected. Pass allowProtected: true after reviewing the plan.`);
}

async function checkoutMergeTarget(workspace, config, target, originalBranch) {
  if (target === originalBranch) return { exitCode: 0, stdout: "", stderr: "" };
  return runProcess("git", ["checkout", target], { cwd: workspace.path, timeout: 60000 }, config);
}

function mergeCommandArgs(source, args, dryRun) {
  return ["merge", ...(dryRun ? ["--no-commit", "--no-ff"] : []), ...(args.ffOnly ? ["--ff-only"] : []), source];
}

async function abortDryRunMergeIfNeeded(workspace, config) {
  const mergeInProgress = await runProcess("git", ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], { cwd: workspace.path, timeout: 30000 }, config);
  if (mergeInProgress.exitCode !== 0) return null;
  return runProcess("git", ["merge", "--abort"], { cwd: workspace.path, timeout: 60000 }, config);
}

async function restoreOriginalBranchIfNeeded(workspace, config, target, originalBranch) {
  if (target === originalBranch) return null;
  return runProcess("git", ["checkout", originalBranch], { cwd: workspace.path, timeout: 60000 }, config);
}

async function dryRunMergeCleanup(workspace, config, target, originalBranch) {
  return {
    aborted: await abortDryRunMergeIfNeeded(workspace, config),
    restoreBranch: await restoreOriginalBranchIfNeeded(workspace, config, target, originalBranch)
  };
}

function mergeBranchOk(merge, aborted, restoreBranch) {
  return merge.exitCode === 0 && (!aborted || aborted.exitCode === 0) && (!restoreBranch || restoreBranch.exitCode === 0);
}

async function relaiGitMergeBranch(workspace, config, args = {}) {
  await ensureGitRepo(workspace, config);
  const source = String(args.source || args.branch || "").trim();
  const originalBranch = await currentGitBranch(workspace, config);
  const target = String(args.target || originalBranch).trim();
  if (!source) throw new Error("relai_git_merge_branch requires source.");
  if (!target) throw new Error("relai_git_merge_branch could not determine target branch.");
  assertMergeTargetAllowed(workspace, target, args);

  const dryRun = args.dryRun !== false;
  const checkout = await checkoutMergeTarget(workspace, config, target, originalBranch);
  if (checkout.exitCode !== 0) return { ok: false, workspace: workspace.alias, source, target, dryRun, checkout: summarizeCommand(checkout) };

  const merge = await runProcess("git", mergeCommandArgs(source, args, dryRun), { cwd: workspace.path, timeout: clampNumber(args.timeoutMs, 1000, 86400000, 120000) }, config);
  const cleanup = dryRun ? await dryRunMergeCleanup(workspace, config, target, originalBranch) : { aborted: null, restoreBranch: null };
  const status = await relaiGitStatus(workspace, config, { maxBytes: args.maxBytes });
  return {
    ok: mergeBranchOk(merge, cleanup.aborted, cleanup.restoreBranch),
    workspace: workspace.alias,
    source,
    target,
    originalBranch,
    dryRun,
    merge: summarizeCommand(merge),
    ...(cleanup.aborted ? { abort: summarizeCommand(cleanup.aborted) } : {}),
    ...(cleanup.restoreBranch ? { restoreBranch: summarizeCommand(cleanup.restoreBranch) } : {}),
    status
  };
}

function protectedRemoteBranches(workspace, targetBranch) {
  const protectedBranches = new Set(protectedBranchList(workspace));
  protectedBranches.add(targetBranch);
  return protectedBranches;
}

function parseRemoteRefLine(line, remote) {
  const [name, committerdate] = line.split("|");
  const short = name ? name.replace(`${remote}/`, "") : "";
  return { name, short, committerdate };
}

function remoteRefExclusion(ref, remote, protectedBranches) {
  if (!ref.name) return { name: ref.name, reason: "empty ref" };
  if (ref.name === `${remote}/HEAD`) return { name: ref.name, reason: "symbolic remote head" };
  if (!ref.short || ref.short === remote || ref.name === remote) return { name: ref.name, reason: "remote name, not a branch" };
  if (protectedBranches.has(ref.short)) return { name: ref.name, reason: "protected or target branch" };
  return null;
}

function staleDaysFromCommitDate(committerdate) {
  if (!committerdate) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(committerdate).getTime()) / (24 * 60 * 60 * 1000)));
}

function branchRisk(short, staleDays) {
  const risk = [];
  if (staleDays != null && staleDays > 45) risk.push("stale branch");
  if (short.includes("release") || short.includes("prod")) risk.push("name overlaps release flow");
  return risk;
}

function recommendedBranchGroup(short) {
  if (short.includes("ui")) return "ui";
  return short.includes("admin") ? "admin" : "general";
}

async function remoteBranchCandidate(workspace, config, remote, targetBranch, ref) {
  const merged = await runProcess("git", ["merge-base", "--is-ancestor", ref.name, `${remote}/${targetBranch}`], { cwd: workspace.path, timeout: 30000 }, config);
  const staleDays = staleDaysFromCommitDate(ref.committerdate);
  return {
    name: ref.name,
    short: ref.short,
    lastCommitAt: ref.committerdate || null,
    staleDays,
    alreadyMerged: merged.exitCode === 0,
    recommendedOrderGroup: recommendedBranchGroup(ref.short),
    risk: branchRisk(ref.short, staleDays)
  };
}

async function remoteBranchPlanItems(workspace, config, refsOutput, remote, targetBranch, protectedBranches) {
  const branches = [];
  const excluded = [];
  for (const line of String(refsOutput || "").split(/\r?\n/).filter(Boolean)) {
    const ref = parseRemoteRefLine(line, remote);
    const exclusion = remoteRefExclusion(ref, remote, protectedBranches);
    if (exclusion) {
      if (exclusion.name) excluded.push(exclusion);
      continue;
    }
    branches.push(await remoteBranchCandidate(workspace, config, remote, targetBranch, ref));
  }
  return { branches, excluded };
}

async function relaiGitMergeRemoteBranchesPlan(workspace, config, args = {}) {
  await ensureGitRepo(workspace, config);
  const remote = String(args.remote || "origin").trim();
  const targetBranch = String(args.targetBranch || "production").trim();
  const protectedBranches = protectedRemoteBranches(workspace, targetBranch);
  const refs = await runProcess("git", ["for-each-ref", "--format=%(refname:short)|%(committerdate:iso8601)", `refs/remotes/${remote}`], { cwd: workspace.path, timeout: 30000 }, config);
  if (refs.exitCode !== 0) return { ok: false, workspace: workspace.alias, remote, targetBranch, refs: summarizeCommand(refs) };
  const { branches, excluded } = await remoteBranchPlanItems(workspace, config, refs.stdout, remote, targetBranch, protectedBranches);
  const mergeCandidates = branches.filter((item) => !item.alreadyMerged).sort(compareMergeCandidates);
  return {
    ok: true,
    workspace: workspace.alias,
    remote,
    targetBranch,
    protectedBranches: [...protectedBranches],
    excluded,
    branches,
    recommendedMergeOrder: mergeCandidates.map((item) => item.name),
    riskSummary: mergeCandidates.filter((item) => item.risk.length > 0).map((item) => ({ name: item.name, risk: item.risk }))
  };
}

async function relaiGitAbortMerge(workspace, config) {
  await ensureGitRepo(workspace, config);
  const abort = await runProcess("git", ["merge", "--abort"], { cwd: workspace.path, timeout: 60000 }, config);
  return { ok: abort.exitCode === 0, workspace: workspace.alias, abort: summarizeCommand(abort) };
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
  relaiGitFetch,
  relaiGitCommit,
  relaiGitPush,
  relaiGitMergeBranch,
  relaiGitMergeRemoteBranchesPlan,
  relaiGitAbortMerge,
  relaiGitCreatePr,
  classifyStatusOwnership,
  getPreparedConfig,
  preparedNumber,
  preparedFlag,
  workflowSummary,
  recommendedFlowForConfig,
  assertPreparedUpdateSafe,
  assertPreparedBundleSafe,
  ensureGitRepo,
  requireCleanGitIfConfigured,
  shouldMakePreparedBackup,
  makePreparedBackup,
  tempStateDir,
  tempStatePath,
  validatePatchPaths,
  clampNumber,
  truncateUtf8,
  DEFAULT_AGGRESSIVE_MAX_PATCH_BYTES,
  DEFAULT_AGGRESSIVE_MAX_ARCHIVE_BYTES
};
