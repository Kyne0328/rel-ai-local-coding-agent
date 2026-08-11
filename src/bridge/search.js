import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { resolveGitExecutable } from '../gitExecutable.js';
import { appendLimited, killProcessTree } from '../process.js';
import { makeProcessEnvironment } from '../processEnvironment.js';
import { isSecretPath } from '../safety.js';
import { clampNumber } from './limits.js';
import { buildContextualSearch } from './searchContext.js';
import { resolveSearchPlan } from './searchPlanner.js';
const DEFAULT_MAX_RESULTS = 200;
const MAX_LINE_CHARS = 400;
const SEARCH_TIMEOUT_MS = 15000;
const MAX_STDERR_BYTES = 64 * 1024;

// Stream git grep output instead of buffering it through runProcess. Broad searches
// can exceed the generic process-output cap; streaming preserves the earliest
// matches while still counting every visible result with bounded memory use.
async function relaiSearch(workspace, _config, args = {}) {
  const pattern = String(args.pattern || "");
  if (!pattern.trim()) throw new Error("relai_search requires a non-empty pattern.");
  if (pattern.length > 1000) throw new Error("relai_search pattern must be 1000 characters or fewer.");
  const maxResults = clampNumber(args.maxResults, 1, 1000, DEFAULT_MAX_RESULTS);
  const gitArgs = ["grep", "-n", "-I", "--untracked", "--no-color", args.fixed === true ? "-F" : "-E"];
  if (args.ignoreCase === true) gitArgs.push("-i");
  gitArgs.push("-e", pattern);
  const glob = String(args.glob || "").trim();
  if (glob) gitArgs.push("--", glob);

  const result = await runGitGrep(workspace, gitArgs, maxResults);
  // Exit 1 means "no matches" — a valid empty result. Anything else is a failure.
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    const stderr = String(result.stderr || result.error || "");
    if (/not a git repository/i.test(stderr)) {
      throw new Error(`relai_search requires the workspace to be a git repository: ${workspace.alias}`);
    }
    throw new Error(`relai_search failed: ${stderr || `git grep exited ${result.exitCode}`}`);
  }

  const baseResult = {
    ok: true,
    workspace: workspace.alias,
    pattern,
    ...(glob ? { glob } : {}),
    matches: result.matches,
    matchCount: result.matchCount,
    truncated: result.matchCount > result.matches.length
  };
  const searchPlan = resolveSearchPlan(args, result);
  if (searchPlan.effectiveMode === "compact") {
    return {
      ...baseResult,
      ...(searchPlan.requestedMode === "auto" ? {
        mode: "auto",
        effectiveMode: "compact",
        autoTier: searchPlan.autoTier
      } : {}),
      next: result.matches.length
        ? "Read only the relevant ranges with relai_read { paths, startLine, endLine }."
        : "No matches. Try a shorter pattern, ignoreCase:true, or relai_snapshot for the file list."
    };
  }
  return {
    ...baseResult,
    ...buildContextualSearch(workspace, result.matches, searchPlan.contextArgs, {
      requestedMode: searchPlan.requestedMode,
      autoTier: searchPlan.autoTier,
      selectionStrategy: searchPlan.selectionStrategy,
      prioritizeFiles: searchPlan.requestedMode === "auto",
      workflowContext: args._workflowContext || {}
    }),
    next: result.matches.length
      ? searchPlan.requestedMode === "auto"
        ? "Adaptive context is included for prioritized matches. Use relai_read only when a wider range or complete file is needed."
        : "Context is included. Use relai_read only when a wider range or complete file is needed."
      : "No matches. Try a shorter pattern, ignoreCase:true, or relai_snapshot for the file list."
  };
}

function runGitGrep(workspace, gitArgs, maxResults) {
  return new Promise((resolve) => {
    const executable = resolveGitExecutable() || "git";
    const child = spawn(executable, gitArgs, {
      cwd: workspace.path,
      env: makeProcessEnvironment(),
      shell: false,
      detached: process.platform !== "win32"
    });
    const decoder = new StringDecoder("utf8");
    const matches = [];
    let matchCount = 0;
    let pending = "";
    let stderr = "";
    let settled = false;

    function consumeLine(rawLine) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line) return;
      const match = parseGitGrepLine(line);
      if (!match || isSecretPath(match.path)) return;
      matchCount += 1;
      if (matches.length < maxResults) matches.push(match);
    }

    function consumeChunk(text, flush = false) {
      pending += text;
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex >= 0) {
        consumeLine(pending.slice(0, newlineIndex));
        pending = pending.slice(newlineIndex + 1);
        newlineIndex = pending.indexOf("\n");
      }
      if (flush && pending) {
        consumeLine(pending);
        pending = "";
      }
    }

    let timer = setTimeout(() => {
      killProcessTree(child);
      finish({
        exitCode: -1,
        signal: "SIGTERM",
        matches,
        matchCount,
        stderr: appendLimited(stderr, `\n[rel-ai-mcp timed out after ${SEARCH_TIMEOUT_MS}ms]\n`, MAX_STDERR_BYTES).trim(),
        error: `Timed out after ${SEARCH_TIMEOUT_MS}ms`
      });
    }, SEARCH_TIMEOUT_MS);
    if (typeof timer.unref === "function") timer.unref();

    function finish(payload) {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      resolve(payload);
    }

    child.stdout.on("data", (chunk) => consumeChunk(decoder.write(chunk)));
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk.toString("utf8"), MAX_STDERR_BYTES);
    });
    child.on("error", (error) => {
      finish({ exitCode: -1, matches, matchCount, stderr: stderr.trim(), error: error.message });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      consumeChunk(decoder.end(), true);
      finish({
        exitCode: typeof code === "number" ? code : -1,
        signal: signal || undefined,
        matches,
        matchCount,
        stderr: stderr.trim()
      });
    });
  });
}

function parseGitGrepLine(line) {
  const first = line.indexOf(":");
  const second = line.indexOf(":", first + 1);
  if (first <= 0 || second <= first) return null;
  const relativePath = line.slice(0, first);
  const lineNumber = Number(line.slice(first + 1, second));
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return null;
  return {
    path: relativePath,
    line: lineNumber,
    text: line.slice(second + 1).slice(0, MAX_LINE_CHARS)
  };
}

export { relaiSearch };
