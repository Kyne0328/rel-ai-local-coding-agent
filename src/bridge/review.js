import * as crypto from "node:crypto";
import { runProcess } from "../process.js";
import * as fs from "node:fs";
import { resolveSafePath, looksBinary, isSecretPath } from "../safety.js";
import { classifyStatusOwnership } from "../repo/gitOps.js";
import { INTERNAL_STATUS_MAX_BYTES, gitStatusArgs, formatGitStatus } from "../repo/gitStatus.js";
import { clampNumber } from "./limits.js";
import { buildSensitiveReview } from "./sensitiveReview.js";

const DEFAULT_MAX_DIFF_BYTES = 1024 * 1024;

async function relaiDiff(workspace, config, args = {}) {
  const staged = Boolean(args.staged);
  const redactSensitive = args.redactSensitive === true;
  const filterPath = resolveReviewFilter(workspace, args.path, redactSensitive);
  const taskOwnedPaths = Array.isArray(args._taskOwnedPaths)
    ? normalizePaths(args._taskOwnedPaths)
    : null;
  const reviewedScope = taskOwnedPaths && args.scope !== 'workspace' ? 'task' : 'workspace';
  if (reviewedScope === 'task' && filterPath && !taskOwnedPaths.includes(filterPath)) {
    throw new Error(`Path '${filterPath}' is outside the task-owned review scope. Pass scope:'workspace' to explicitly widen this review.`);
  }

  // Status must complete before any diff is read. Its canonical NUL-delimited paths
  // define the allowlist and prevent a speculative unscoped diff from ever loading
  // sensitive-file content into process memory.
  const stat = await runProcess('git', gitStatusArgs(), {
    cwd: workspace.path,
    timeout: 30000,
    maxOutputBytes: INTERNAL_STATUS_MAX_BYTES
  }, config);
  if (stat.exitCode !== 0 || stat.stdoutTruncated) {
    throw new Error(`git status failed for ${workspace.alias}: ${stat.stderr || (stat.stdoutTruncated ? 'output exceeded internal limit' : stat.exitCode)}`);
  }
  const ownership = classifyStatusOwnership(workspace, config, stat.stdout || '');
  const workspaceChangedPaths = normalizePaths(ownership.entries.map(entry => entry.path));
  const scopedPaths = reviewedScope === 'task'
    ? workspaceChangedPaths.filter(file => taskOwnedPaths.includes(file))
    : workspaceChangedPaths;
  const changedPaths = filterPath ? scopedPaths.filter(file => file === filterPath) : scopedPaths;
  const excludedWorkspaceFiles = reviewedScope === 'task'
    ? workspaceChangedPaths.filter(file => !taskOwnedPaths.includes(file))
    : [];
  const sensitivePaths = [...new Set(changedPaths.filter(item => isSecretPath(item)))];
  if (filterPath && sensitivePaths.length > 0 && !redactSensitive) {
    throw new Error(`Sensitive path review requires redactSensitive:true: ${filterPath}`);
  }

  const ordinaryPaths = sensitivePaths.length
    ? changedPaths.filter(item => !isSecretPath(item))
    : changedPaths;
  const pathScoped = reviewedScope === 'task' || filterPath != null || sensitivePaths.length > 0;
  const diff = await runOrdinaryDiff(workspace, config, staged, ordinaryPaths, pathScoped);
  let diffText = diff.stdout || '';
  if (!staged) {
    const untracked = new Set(ownership.entries.filter(entry => entry.untracked && !isSecretPath(entry.path)).map(entry => entry.path));
    diffText += buildUntrackedDiff(workspace, changedPaths.filter(file => untracked.has(file)));
  }
  const sensitiveReview = redactSensitive
    ? await buildSensitiveReview(workspace, config, sensitivePaths, ownership, staged)
    : [];
  const maxBytes = clampNumber(args.maxBytes, 1000, 5 * 1024 * 1024, DEFAULT_MAX_DIFF_BYTES);
  const reviewedFiles = normalizePaths(changedPaths);
  const scopedOwnership = scopeOwnership(ownership, new Set(reviewedFiles));
  const reviewHash = crypto.createHash("sha256").update(diffText).update(JSON.stringify(sensitiveReview)).digest("hex");
  return {
    ok: stat.exitCode === 0 && diff.exitCode === 0,
    workspace: workspace.alias,
    staged,
    redactSensitive,
    reviewScope: reviewedScope,
    reviewedScope,
    reviewHash,
    reviewedFiles,
    excludedWorkspaceFiles,
    ...(filterPath ? { path: filterPath } : {}),
    status: formatGitStatus(scopedOwnership),
    branch: ownership.branch,
    aheadBehind: ownership.aheadBehind,
    statusEntries: scopedOwnership.entries,
    sessionChangedFiles: scopedOwnership.sessionChanged,
    baselineChangedFiles: scopedOwnership.baselineChanged,
    untrackedSessionFiles: scopedOwnership.untrackedSession,
    untrackedBaselineFiles: scopedOwnership.untrackedBaseline,
    ...(ownership.baselineSource ? { baselineSource: ownership.baselineSource } : {}),
    diff: truncateDiff(diffText, maxBytes),
    sensitiveReview,
    sensitiveValuesReturned: false,
    exitCode: diff.exitCode,
    ...(diff.stderr ? { stderr: diff.stderr } : {})
  };
}

function scopeOwnership(ownership, reviewed) {
  const keep = values => (Array.isArray(values) ? values : []).filter(file => reviewed.has(file));
  return {
    ...ownership,
    entries: (ownership.entries || []).filter(entry => reviewed.has(entry.path)),
    sessionChanged: keep(ownership.sessionChanged),
    baselineChanged: keep(ownership.baselineChanged),
    untrackedSession: keep(ownership.untrackedSession),
    untrackedBaseline: keep(ownership.untrackedBaseline)
  };
}

function resolveReviewFilter(workspace, rawPath, redactSensitive) {
  if (!rawPath) return null;
  return resolveSafePath(workspace.path, rawPath, {
    operation: redactSensitive ? 'review-redacted' : 'review'
  }).relativePath;
}

async function runOrdinaryDiff(workspace, config, staged, paths, pathScoped) {
  if (pathScoped && paths.length === 0) return { stdout: '', stderr: '', exitCode: 0 };
  const args = ['diff', ...(staged ? ['--staged'] : [])];
  if (paths.length > 0) args.push('--', ...paths);
  return runProcess('git', args, { cwd: workspace.path, timeout: 60000 }, config);
}

function truncateDiff(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  return Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/u, '') + `\n[rel-ai-mcp diff truncated at ${maxBytes} bytes]`;
}

function buildUntrackedDiff(workspace, paths) {
  const sections = [];
  for (const relativePath of paths) {
    try {
      const safe = resolveSafePath(workspace.path, relativePath, { operation: 'review' });
      const data = fs.readFileSync(safe.absolutePath);
      if (looksBinary(data)) {
        sections.push(`\ndiff --git a/${safe.relativePath} b/${safe.relativePath}\nnew file mode 100644\nBinary files /dev/null and b/${safe.relativePath} differ\n`);
        continue;
      }
      const text = data.toString('utf8').replaceAll('\r\n', '\n');
      const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
      sections.push(['', `diff --git a/${safe.relativePath} b/${safe.relativePath}`, 'new file mode 100644', '--- /dev/null', `+++ b/${safe.relativePath}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map(line => `+${line}`), ''].join('\n'));
    } catch (error) {
      sections.push(`\n[rel-ai-mcp could not read untracked file ${relativePath}: ${error instanceof Error ? error.message : String(error)}]\n`);
    }
  }
  return sections.join('');
}

function normalizePaths(values) {
  return [...new Set((values || []).map(value => String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '')).filter(Boolean))].sort();
}

export { relaiDiff };