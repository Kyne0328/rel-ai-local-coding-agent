import { readSessionPolicy } from "../policyResolver.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { runProcess, summarizeCommand } from "../process.js";
import { resolveSafePath, isSecretPath } from "../safety.js";
import { getStateDir } from '../statePaths.js';
import { INTERNAL_STATUS_MAX_BYTES, gitStatusArgs, parseGitStatus, formatGitStatus } from "./gitStatus.js";

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

function statusOwnerForFile(file, hasSession, baselineSet) {
  if (!hasSession) return "unknown";
  return baselineSet.has(file) ? "baseline" : "session";
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
  const parsed = parseGitStatus(statusOutput);

  for (const parsedEntry of parsed.entries) {
    recordStatusEntry(groups, {
      ...parsedEntry,
      owner: statusOwnerForFile(parsedEntry.path, hasSession, baselineSet)
    });
  }

  return {
    branchRaw: parsed.branchRaw,
    branch: parsed.branch,
    aheadBehind: parsed.aheadBehind,
    hasSession,
    baselineSource,
    ...groups
  };
}

// ---- Git operation private helpers -------------------------------------------

async function ensureGitRepo(workspace, config) {
  const result = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], { cwd: workspace.path, timeout: 30000 }, config);
  if (result.exitCode !== 0 || !String(result.stdout || "").trim().startsWith("true")) throw new Error(`Workspace '${workspace.alias}' is not a git work tree.`);
}

async function gitStatusShort(workspace, config) {
  const result = await runProcess("git", gitStatusArgs({ branch: false }), {
    cwd: workspace.path,
    timeout: 30000,
    maxOutputBytes: INTERNAL_STATUS_MAX_BYTES
  }, config);
  if (result.exitCode !== 0 || result.stdoutTruncated) {
    throw new Error(`git status failed for ${workspace.alias}: ${result.stderr || result.stdout || (result.stdoutTruncated ? "output exceeded internal limit" : result.exitCode)}`);
  }
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

async function inspectPatchPaths(workspace, config, patch, timeoutMs = 120000) {
  const check = await runProcess("git", ["apply", "--check", "--numstat", "-z", "--summary", "--recount", "-"], {
    cwd: workspace.path,
    input: patch,
    timeout: timeoutMs,
    maxOutputBytes: INTERNAL_STATUS_MAX_BYTES
  }, config);
  if (check.exitCode !== 0) return { check, touchedPaths: [] };
  if (check.stdoutTruncated) {
    throw new Error("git apply path inspection exceeded the internal output limit.");
  }

  const candidates = [
    ...parseApplyInspectionPaths(check.stdout || ""),
    ...extractPatchMetadataPaths(patch)
  ];
  const touchedPaths = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || candidate === "/dev/null") continue;
    // Resolve containment first, then apply the unified-diff-specific sensitive-path
    // policy below. The temporary commit allowance prevents the generic path guard
    // from obscuring the canonical patch error and does not authorize any mutation.
    const safe = resolveSafePath(workspace.path, candidate, { operation: "commit", allowSensitive: true });
    if (isSecretPath(safe.relativePath)) throw sensitiveUnifiedDiffError(safe.relativePath);
    if (!seen.has(safe.relativePath)) {
      seen.add(safe.relativePath);
      touchedPaths.push(safe.relativePath);
    }
  }
  if (touchedPaths.length === 0) {
    throw new Error("Git accepted the patch but did not report any workspace file paths.");
  }
  return { check, touchedPaths };
}

function parseApplyInspectionPaths(output) {
  const text = String(output || "");
  const lastNul = text.lastIndexOf("\0");
  const numstat = lastNul >= 0 ? text.slice(0, lastNul + 1) : "";
  const summary = lastNul >= 0 ? text.slice(lastNul + 1) : text;
  const paths = [];
  for (const record of numstat.split("\0")) {
    if (!record) continue;
    const match = /^(?:\d+|-)\t(?:\d+|-)\t([\s\S]+)$/.exec(record);
    if (match?.[1]) paths.push(match[1]);
  }
  for (const line of summary.split(/\r?\n/)) {
    const match = /^\s*(?:create|delete) mode \d+ (.+)$/.exec(line)
      || /^\s*mode change \d+ => \d+ (.+)$/.exec(line);
    if (match?.[1]) paths.push(decodeGitQuotedPath(match[1]));
  }
  return paths;
}

function extractPatchMetadataPaths(patch) {
  const paths = [];
  for (const line of String(patch || "").split(/\r?\n/)) {
    for (const prefix of ["rename from ", "rename to ", "copy from ", "copy to "]) {
      if (line.startsWith(prefix)) paths.push(decodeGitQuotedPath(line.slice(prefix.length)));
    }
  }
  return paths;
}

function decodeGitQuotedPath(value) {
  const text = String(value || "").trim();
  if (!text.startsWith('"')) return text;
  const bytes = [];
  for (let index = 1; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') break;
    if (character !== "\\") {
      bytes.push(...Buffer.from(character, "utf8"));
      continue;
    }
    const escaped = text[++index];
    if (escaped == null) break;
    if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      while (octal.length < 3 && /[0-7]/.test(text[index + 1] || "")) octal += text[++index];
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    const escapes = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
    bytes.push(Object.hasOwn(escapes, escaped) ? escapes[escaped] : escaped.charCodeAt(0));
  }
  return Buffer.from(bytes).toString("utf8");
}

function sensitiveUnifiedDiffError(relativePath) {
  const error = new Error(
    `Unified diff edits cannot target sensitive-classified path '${relativePath}' because the proposed final content cannot be inspected safely. Use a structured OpenAI patch or exact relai_edit replacement so final content is validated.`
  );
  error.code = "SENSITIVE_PATCH_REQUIRES_CONTENT_VALIDATION";
  error.source = "rel-ai-mcp-policy";
  error.path = relativePath;
  error.operation = "write";
  error.retryable = false;
  return error;
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

async function workspaceGitStatus(workspace, config, args = {}) {
  const maxBytes = clampNumber(args.maxBytes, 1000, 5 * 1024 * 1024, DEFAULT_MAX_GIT_OUTPUT_BYTES);
  const status = await runProcess("git", gitStatusArgs(), {
    cwd: workspace.path,
    timeout: 30000,
    maxOutputBytes: INTERNAL_STATUS_MAX_BYTES
  }, config);
  const ownership = classifyStatusOwnership(workspace, config, status.stdout || "");
  return {
    ok: status.exitCode === 0 && !status.stdoutTruncated,
    workspace: workspace.alias,
    branch: ownership.branch,
    aheadBehind: ownership.aheadBehind,
    status: truncateUtf8(formatGitStatus(ownership), maxBytes, "git status"),
    statusEntries: ownership.entries,
    changedFiles: ownership.entries.map((entry) => entry.path),
    untrackedFiles: ownership.entries.filter((entry) => entry.untracked).map((entry) => entry.path),
    sessionChangedFiles: ownership.sessionChanged,
    baselineChangedFiles: ownership.baselineChanged,
    untrackedSessionFiles: ownership.untrackedSession,
    untrackedBaselineFiles: ownership.untrackedBaseline,
    ...(ownership.baselineSource ? { baselineSource: ownership.baselineSource } : {}),
    ...(status.stderr ? { stderr: truncateUtf8(status.stderr, maxBytes, "git status stderr") } : {})
  };
}

async function relaiGitCommit(workspace, config, args = {}) {
  // The work-tree probe and the status read are independent child processes, so start
  // the probe here and let it overlap argument validation and the status spawn instead
  // of paying for both spawns back to back. The no-op catch only marks the rejection as
  // handled in case validation below throws first; awaiting it still surfaces the error.
  const repoProbe = ensureGitRepo(workspace, config);
  repoProbe.catch(() => {});
  const message = String(args.message || "").trim();
  if (!message) throw new Error("relai_git_commit requires a non-empty commit message.");
  const dryRun = Boolean(args.dryRun);
  const authorization = normalizeSensitiveAuthorization(workspace, args);
  const paths = Array.isArray(args.paths)
    ? args.paths.map((item) => resolveSafePath(workspace.path, item, {
        operation: "commit",
        allowSensitive: authorization.authorizedPaths.has(normalizeGitPath(item))
      }).relativePath)
    : [];
  const addAll = paths.length === 0 && args.addAll !== false;
  const statusRead = workspaceGitStatus(workspace, config, { maxBytes: args.maxBytes });
  statusRead.catch(() => {});
  await repoProbe;
  const statusBefore = await statusRead;
  if (dryRun) {
    return {
      ok: true,
      workspace: workspace.alias,
      dryRun: true,
      message,
      addAll,
      paths,
      ...(authorization.metadata ? { sensitiveAuthorization: authorization.metadata } : {}),
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
  // tools refuse to touch (.env, keys, credentials). Every staged sensitive path
  // must be named in a commit-scoped authorization object.
  const staged = await runProcess("git", ["diff", "--cached", "--name-only"], { cwd: workspace.path, timeout: 60000 }, config);
  const secretStaged = String(staged.stdout || "").split(/\r?\n/).map((line) => normalizeGitPath(line)).filter((file) => file && isSecretPath(file));
  const unauthorizedSecretPaths = secretStaged.filter((file) => !authorization.authorizedPaths.has(file));
  if (unauthorizedSecretPaths.length > 0) {
    const indexRestore = await restoreIndex();
    return {
      ok: false,
      workspace: workspace.alias,
      message,
      addAll,
      paths,
      secretStagedFiles: secretStaged,
      unauthorizedSecretPaths,
      ...(authorization.metadata ? { sensitiveAuthorization: authorization.metadata } : {}),
      indexRestored: indexRestore?.exitCode === 0,
      error: `Refusing to commit sensitive paths without matching commit authorization: ${unauthorizedSecretPaths.join(", ")}. The pre-operation index was restored.`
    };
  }
  const commit = await runProcess("git", ["commit", "-m", message], { cwd: workspace.path, timeout: clampNumber(args.timeoutMs, 1000, 86400000, 120000) }, config);
  const statusAfter = await workspaceGitStatus(workspace, config, { maxBytes: args.maxBytes });
  return {
    ok: commit.exitCode === 0,
    workspace: workspace.alias,
    message,
    addAll,
    paths,
    ...(authorization.metadata ? { sensitiveAuthorization: authorization.metadata } : {}),
    commit: summarizeCommand(commit),
    statusBefore,
    statusAfter
  };
}

function normalizeSensitiveAuthorization(workspace, args = {}) {
  const raw = args.sensitiveAuthorization;
  if (raw == null) return { authorizedPaths: new Set(), metadata: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("sensitiveAuthorization must be an object with operation, paths, and reason.");
  }
  if (String(raw.operation || "").trim() !== "commit") {
    throw new Error("sensitiveAuthorization.operation must be 'commit'.");
  }
  const reason = String(raw.reason || "").trim();
  if (!reason || reason.length > 500) {
    throw new Error("sensitiveAuthorization.reason must contain 1 to 500 characters.");
  }
  if (!Array.isArray(raw.paths) || raw.paths.length === 0 || raw.paths.length > 200) {
    throw new Error("sensitiveAuthorization.paths must contain 1 to 200 paths.");
  }
  const paths = [...new Set(raw.paths.map((item) => normalizeGitPath(item)).filter(Boolean))];
  for (const item of paths) {
    resolveSafePath(workspace.path, item, { operation: "commit", allowSensitive: true });
    if (!isSecretPath(item)) throw new Error(`sensitiveAuthorization path is not classified as sensitive: ${item}`);
  }
  return {
    authorizedPaths: new Set(paths),
    metadata: {
      operation: "commit",
      paths,
      reason,
      reasonProvided: true,
      source: "explicit"
    }
  };
}

function normalizeGitPath(value) {
  return String(value || "").replaceAll("\\", "/").trim().replace(/^\.\//, "");
}

// A branch name, not a refspec. Rejects deletes (":main"), force pushes
// ("+HEAD:main"), option-looking values, and git's own invalid-ref forms.
function assertPlainBranchName(branch) {
  if (branch.includes(":")) {
    throw new Error(`relai_git_push expects a branch name, not a refspec: ${branch}`);
  }
  if (branch.startsWith("+") || branch.startsWith("-")) {
    throw new Error(`relai_git_push branch must not start with '+' or '-': ${branch}`);
  }
  if (/[\s~^?*[\\]/.test(branch) || branch.includes("..") || branch.includes("@{") || branch.endsWith(".lock") || branch.endsWith("/")) {
    throw new Error(`relai_git_push branch name is not a valid ref: ${branch}`);
  }
}

async function relaiGitPush(workspace, config, args = {}) {
  await ensureGitRepo(workspace, config);
  const remote = assertRemoteAllowed(workspace, String(args.remote || "origin").trim());
  const branch = String(args.branch || await currentGitBranch(workspace, config)).trim();
  if (!branch) throw new Error("relai_git_push could not determine the branch to push.");
  // git push treats this argument as a refspec: ":main" deletes the remote branch and
  // "+HEAD:main" force-pushes over it. Accept a plain branch name only.
  assertPlainBranchName(branch);
  const dryRun = Boolean(args.dryRun);
  const setUpstream = Boolean(args.setUpstream);
  const pushArgs = ["push", ...(dryRun ? ["--dry-run"] : []), ...(setUpstream ? ["--set-upstream"] : []), remote, branch];
  const push = await runProcess("git", pushArgs, { cwd: workspace.path, timeout: clampNumber(args.timeoutMs, 1000, 86400000, 120000) }, config);
  return { ok: push.exitCode === 0, workspace: workspace.alias, remote, branch, dryRun, setUpstream, push: summarizeCommand(push) };
}

async function relaiGitDraftPr(workspace, config, args = {}) {
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
    draftOnly: true,
    remoteChanged: false,
    ...(emptyDiff ? { warning: `No diff between ${base} and ${head}; refusing to draft an empty pull request.` } : {}),
    diff: summarizeCommand(diff)
  };
}

export { workspaceGitStatus, relaiGitCommit, relaiGitPush, relaiGitDraftPr, classifyStatusOwnership, getPatchConfig, patchNumber, patchFlag, assertPatchUpdateSafe, ensureGitRepo, requireCleanGitIfConfigured, shouldMakePatchBackup, makePatchBackup, tempStateDir, tempStatePath, inspectPatchPaths, clampNumber, truncateUtf8, DEFAULT_AGGRESSIVE_MAX_PATCH_BYTES };
