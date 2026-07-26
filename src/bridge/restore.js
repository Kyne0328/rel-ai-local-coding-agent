const { runProcess, summarizeCommand } = require("../process");
const { resolveSafePath } = require("../safety");

// resolveSafePath validates these as filesystem paths, but git reads them as
// pathspecs: "*" or "." after `--` matches the whole worktree, so a single-file
// restore request could discard every uncommitted change without the RESET
// confirmation that relai_reset_workspace demands.
const PATHSPEC_MAGIC = /[*?[\]]/;

function normalizePaths(workspace, paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("relai_restore_paths requires at least one path.");
  }
  return paths.map((item) => {
    const relativePath = resolveSafePath(workspace.path, item, { operation: "restore" }).relativePath;
    if (PATHSPEC_MAGIC.test(relativePath) || relativePath === ".") {
      throw new Error(`relai_restore_paths requires literal file paths, not patterns: ${relativePath}. Use relai_reset_workspace with confirmation RESET to discard everything.`);
    }
    return relativePath;
  });
}

async function relaiRestorePaths(workspace, config, args = {}) {
  const paths = normalizePaths(workspace, args.paths);
  // ":(literal)" stops git re-interpreting a legitimate filename that happens to
  // contain pathspec syntax.
  const restore = await runProcess("git", ["restore", "--", ...paths.map((item) => `:(literal)${item}`)], {
    cwd: workspace.path,
    timeout: 60000
  }, config);
  return {
    workspace: workspace.alias,
    mode: "paths",
    paths,
    ...summarizeCommand(restore),
    ok: restore.exitCode === 0
  };
}

function expectedConfirmation(removeUntracked) {
  return removeUntracked ? "RESET_AND_CLEAN" : "RESET";
}

async function relaiResetWorkspace(workspace, config, args = {}) {
  const removeUntracked = args.removeUntracked === true;
  const expected = expectedConfirmation(removeUntracked);
  const confirmation = String(args.confirmation || "").trim();
  if (confirmation !== expected) {
    throw new Error(`relai_reset_workspace requires confirmation='${expected}'${removeUntracked ? " when removeUntracked is true" : ""}.`);
  }

  const reset = await runProcess("git", ["reset", "--hard", "HEAD"], {
    cwd: workspace.path,
    timeout: 60000
  }, config);
  let clean = null;
  if (reset.exitCode === 0 && removeUntracked) {
    clean = await runProcess("git", ["clean", "-fd"], {
      cwd: workspace.path,
      timeout: 60000
    }, config);
  }
  return {
    ok: reset.exitCode === 0 && (!clean || clean.exitCode === 0),
    workspace: workspace.alias,
    mode: "workspace-reset",
    removeUntracked,
    reset: summarizeCommand(reset),
    ...(clean ? { clean: summarizeCommand(clean) } : {})
  };
}

module.exports = { relaiResetWorkspace, relaiRestorePaths };
