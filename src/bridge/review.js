const { runProcess } = require('../process');
const fs = require('node:fs');
const { resolveSafePath, looksBinary, isSecretPath } = require('../safety');
const { classifyStatusOwnership } = require('../repo/gitOps');
const { clampNumber } = require('./limits');
const { buildSensitiveReview } = require('./sensitiveReview');

const DEFAULT_MAX_DIFF_BYTES = 1024 * 1024;

async function relaiDiff(workspace, config, args = {}) {
  const staged = Boolean(args.staged);
  const redactSensitive = args.redactSensitive === true;
  const stat = await runProcess('git', ['status', '--short', '--branch'], { cwd: workspace.path, timeout: 30000 }, config);
  const ownership = classifyStatusOwnership(workspace, config, stat.stdout || '');
  const filterPath = resolveReviewFilter(workspace, args.path, redactSensitive);
  const changedPaths = filterPath ? [filterPath] : ownership.entries.map((entry) => entry.path);
  const sensitivePaths = [...new Set(changedPaths.filter((item) => isSecretPath(item)))];
  if (filterPath && sensitivePaths.length > 0 && !redactSensitive) {
    throw new Error(`Sensitive path review requires redactSensitive:true: ${filterPath}`);
  }

  const ordinaryPaths = filterPath
    ? (sensitivePaths.length ? [] : [filterPath])
    : [...new Set(changedPaths.filter((item) => !isSecretPath(item)))];
  const pathScoped = filterPath != null || (redactSensitive && sensitivePaths.length > 0);
  const diff = await runOrdinaryDiff(workspace, config, staged, ordinaryPaths, pathScoped);
  let diffText = diff.stdout || '';
  if (!staged) {
    const untracked = ownership.entries.filter((entry) => entry.untracked && !isSecretPath(entry.path)).map((entry) => entry.path);
    const selected = filterPath ? untracked.filter((file) => file === filterPath) : untracked;
    diffText += buildUntrackedDiff(workspace, selected);
  }
  const sensitiveReview = redactSensitive
    ? await buildSensitiveReview(workspace, config, sensitivePaths, ownership, staged)
    : [];
  const maxBytes = clampNumber(args.maxBytes, 1000, 5 * 1024 * 1024, DEFAULT_MAX_DIFF_BYTES);
  return {
    ok: stat.exitCode === 0 && diff.exitCode === 0,
    workspace: workspace.alias,
    staged,
    redactSensitive,
    ...(filterPath ? { path: filterPath } : {}),
    status: stat.stdout || '',
    branch: ownership.branch,
    aheadBehind: ownership.aheadBehind,
    statusEntries: ownership.entries,
    sessionChangedFiles: ownership.sessionChanged,
    baselineChangedFiles: ownership.baselineChanged,
    untrackedSessionFiles: ownership.untrackedSession,
    untrackedBaselineFiles: ownership.untrackedBaseline,
    ...(ownership.baselineSource ? { baselineSource: ownership.baselineSource } : {}),
    diff: truncateDiff(diffText, maxBytes),
    sensitiveReview,
    sensitiveValuesReturned: false,
    exitCode: diff.exitCode,
    ...(diff.stderr ? { stderr: diff.stderr } : {})
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
      sections.push(['', `diff --git a/${safe.relativePath} b/${safe.relativePath}`, 'new file mode 100644', '--- /dev/null', `+++ b/${safe.relativePath}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`), ''].join('\n'));
    } catch (error) {
      sections.push(`\n[rel-ai-mcp could not read untracked file ${relativePath}: ${error instanceof Error ? error.message : String(error)}]\n`);
    }
  }
  return sections.join('');
}

module.exports = { relaiDiff };
