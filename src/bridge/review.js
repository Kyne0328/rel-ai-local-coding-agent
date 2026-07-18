const { runProcess, summarizeCommand } = require("../process");
const fs = require("node:fs");
const { resolveSafePath, looksBinary } = require("../safety");
const { classifyStatusOwnership } = require("../repo/gitOps");
const { clampNumber } = require("./limits");

const DEFAULT_MAX_DIFF_BYTES = 1024 * 1024;

async function relaiDiff(workspace, config, args = {}) {
  const staged = Boolean(args.staged);
  const stat = await runProcess("git", ["status", "--short", "--branch"], { cwd: workspace.path, timeout: 30000 }, config);
  const diffArgs = ["diff", ...(staged ? ["--staged"] : [])];
  const filterPath = args.path ? resolveSafePath(workspace.path, args.path).relativePath : null;
  if (filterPath) diffArgs.push("--", filterPath);
  const diff = await runProcess("git", diffArgs, { cwd: workspace.path, timeout: 60000 }, config);
  const maxBytes = clampNumber(args.maxBytes, 1000, 5 * 1024 * 1024, DEFAULT_MAX_DIFF_BYTES);
  let diffText = diff.stdout || "";
  const ownership = classifyStatusOwnership(workspace, config, stat.stdout || "");
  if (!staged) {
    const untracked = ownership.entries.filter(entry => entry.untracked).map(entry => entry.path);
    const selected = filterPath ? untracked.filter(file => file === filterPath) : untracked;
    diffText += buildUntrackedDiff(workspace, selected);
  }
  return {
    ok: stat.exitCode === 0 && diff.exitCode === 0,
    workspace: workspace.alias,
    staged,
    ...(filterPath ? { path: filterPath } : {}),
    status: stat.stdout || "",
    branch: ownership.branch,
    aheadBehind: ownership.aheadBehind,
    statusEntries: ownership.entries,
    sessionChangedFiles: ownership.sessionChanged,
    baselineChangedFiles: ownership.baselineChanged,
    untrackedSessionFiles: ownership.untrackedSession,
    untrackedBaselineFiles: ownership.untrackedBaseline,
    ...(ownership.baselineSource ? { baselineSource: ownership.baselineSource } : {}),
    diff: truncateDiff(diffText, maxBytes),
    exitCode: diff.exitCode,
    ...(diff.stderr ? { stderr: diff.stderr } : {})
  };
}

function truncateDiff(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  return Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/u, '') + `\n[rel-ai-mcp diff truncated at ${maxBytes} bytes]`;
}

function buildUntrackedDiff(workspace, paths) {
  const sections = [];
  for (const relativePath of paths) {
    try {
      const safe = resolveSafePath(workspace.path, relativePath);
      const data = fs.readFileSync(safe.absolutePath);
      if (looksBinary(data)) {
        sections.push(`\ndiff --git a/${safe.relativePath} b/${safe.relativePath}\nnew file mode 100644\nBinary files /dev/null and b/${safe.relativePath} differ\n`);
        continue;
      }
      const text = data.toString('utf8').replaceAll('\r\n', '\n');
      const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
      sections.push([
        '',
        `diff --git a/${safe.relativePath} b/${safe.relativePath}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${safe.relativePath}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map(line => `+${line}`),
        ''
      ].join('\n'));
    } catch (error) {
      sections.push(`\n[rel-ai-mcp could not read untracked file ${relativePath}: ${error instanceof Error ? error.message : String(error)}]\n`);
    }
  }
  return sections.join('');
}

async function relaiReset(workspace, config, args = {}) {
  const mode = String(args.mode || "paths").toLowerCase();
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (paths.length > 0) {
    const safePaths = paths.map((p) => resolveSafePath(workspace.path, p).relativePath);
    const restore = await runProcess("git", ["restore", "--", ...safePaths], { cwd: workspace.path, timeout: 60000 }, config);
    // git restore only knows TRACKED paths, so an untracked disposable file makes it
    // exit non-zero with a pathspec error. With clean:true, also remove untracked
    // matches via git clean and treat that restore pathspec-miss as non-fatal — so
    // clean:true + paths can revert tracked edits AND delete untracked files.
    let clean = null;
    if (args.clean) clean = await runProcess("git", ["clean", "-fd", "--", ...safePaths], { cwd: workspace.path, timeout: 60000 }, config);
    const restorePathspecMiss = restore.exitCode !== 0 && /did not match any file|pathspec/i.test(restore.stderr || "");
    const restoreOk = restore.exitCode === 0 || (Boolean(args.clean) && restorePathspecMiss);
    const cleanOk = !clean || clean.exitCode === 0;
    // ok is computed last so the spread summarizeCommand(restore).ok (which reflects
    // only the restore step) cannot override the combined restore+clean result.
    return { workspace: workspace.alias, mode: "paths", paths: safePaths, ...summarizeCommand(restore), ...(clean ? { clean: summarizeCommand(clean) } : {}), ok: restoreOk && cleanOk };
  }
  if (mode !== "hard") throw new Error("relai_restore_changes requires paths, or mode='hard'.");
  const reset = await runProcess("git", ["reset", "--hard"], { cwd: workspace.path, timeout: 60000 }, config);
  let clean = null;
  if (args.clean) clean = await runProcess("git", ["clean", "-fd"], { cwd: workspace.path, timeout: 60000 }, config);
  return { ok: reset.exitCode === 0 && (!clean || clean.exitCode === 0), workspace: workspace.alias, mode: "hard", reset: summarizeCommand(reset), ...(clean ? { clean: summarizeCommand(clean) } : {}) };
}

module.exports = { relaiDiff, relaiReset };
