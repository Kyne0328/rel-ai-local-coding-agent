const { runProcess, summarizeCommand } = require("../process");
const { resolveSafePath } = require("../safety");
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
  const diffText = diff.stdout || "";
  const ownership = classifyStatusOwnership(workspace, config, stat.stdout || "");
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
    diff: Buffer.byteLength(diffText, "utf8") > maxBytes ? diffText.slice(0, maxBytes) + `\n[rel-ai-mcp diff truncated at ${maxBytes} bytes]` : diffText,
    exitCode: diff.exitCode,
    ...(diff.stderr ? { stderr: diff.stderr } : {})
  };
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
