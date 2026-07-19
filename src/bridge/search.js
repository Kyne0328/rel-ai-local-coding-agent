const { runProcess } = require("../process");
const { isSecretPath } = require("../safety");
const { clampNumber } = require("./limits");

const DEFAULT_MAX_RESULTS = 200;
const MAX_LINE_CHARS = 400;

// git grep does the heavy lifting: it respects .gitignore, skips binaries (-I),
// and includes untracked files (--untracked) so freshly written files are found
// before any commit exists.
async function relaiSearch(workspace, config, args = {}) {
  const pattern = String(args.pattern || "");
  if (!pattern.trim()) throw new Error("relai_search requires a non-empty pattern.");
  if (pattern.length > 1000) throw new Error("relai_search pattern must be 1000 characters or fewer.");
  const maxResults = clampNumber(args.maxResults, 1, 1000, DEFAULT_MAX_RESULTS);
  const gitArgs = ["grep", "-n", "-I", "--untracked", "--no-color", args.fixed === true ? "-F" : "-E"];
  if (args.ignoreCase === true) gitArgs.push("-i");
  gitArgs.push("-e", pattern);
  const glob = String(args.glob || "").trim();
  if (glob) gitArgs.push("--", glob);

  const result = await runProcess("git", gitArgs, { cwd: workspace.path, timeout: 15000 }, config);
  // Exit 1 means "no matches" — a valid empty result. Anything else is a failure.
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    const stderr = String(result.stderr || result.error || "");
    if (/not a git repository/i.test(stderr)) {
      throw new Error(`relai_search requires the workspace to be a git repository: ${workspace.alias}`);
    }
    throw new Error(`relai_search failed: ${stderr || `git grep exited ${result.exitCode}`}`);
  }

  const matches = [];
  let total = 0;
  for (const line of String(result.stdout || "").split("\n")) {
    if (!line) continue;
    const first = line.indexOf(":");
    const second = line.indexOf(":", first + 1);
    if (first <= 0 || second <= first) continue;
    const relativePath = line.slice(0, first);
    const lineNumber = Number(line.slice(first + 1, second));
    if (!Number.isInteger(lineNumber) || lineNumber < 1) continue;
    if (isSecretPath(relativePath)) continue;
    total += 1;
    if (matches.length < maxResults) {
      matches.push({ path: relativePath, line: lineNumber, text: line.slice(second + 1).slice(0, MAX_LINE_CHARS) });
    }
  }

  return {
    ok: true,
    workspace: workspace.alias,
    pattern,
    ...(glob ? { glob } : {}),
    matches,
    matchCount: total,
    truncated: total > matches.length,
    next: matches.length
      ? "Read only the relevant ranges with relai_read { paths, startLine, endLine }."
      : "No matches. Try a shorter pattern, ignoreCase:true, or relai_repo_snapshot for the file list."
  };
}

module.exports = { relaiSearch };
