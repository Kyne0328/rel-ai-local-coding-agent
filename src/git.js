const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runProcess, summarizeCommand } = require("./process");
const { validateDiffPaths, safeCommandPolicy } = require("./safety");
const { discoverCommands } = require("./commandDiscovery");
const { applyLoosePatch, isPatchParserError } = require("./loosePatch");

function runGit(args, workspace, config) {
  return runProcess("git", args, { cwd: workspace.path, shell: false }, config);
}

async function currentBranch(workspace, config) {
  const branch = await runGit(["branch", "--show-current"], workspace, config);
  return branch.stdout.trim();
}

function isProtectedBranch(workspace, branch) {
  return (workspace.protectedBranches || ["main", "master"]).includes(String(branch || "").trim());
}

async function gitStatus(workspace, config) {
  const branch = await runGit(["branch", "--show-current"], workspace, config);
  const status = await runGit(["status", "--short", "--branch"], workspace, config);
  const porcelain = await runGit(["status", "--porcelain=v1"], workspace, config);
  return {
    ok: status.exitCode === 0,
    branch: branch.stdout || "",
    clean: porcelain.exitCode === 0 && !porcelain.stdout.trim(),
    status: summarizeCommand(status)
  };
}

async function gitDiff(workspace, config, options = {}) {
  const args = options.staged ? ["diff", "--staged"] : ["diff"];
  if (options.path) args.push("--", options.path);
  const diff = await runGit(args, workspace, config);
  return { ok: diff.exitCode === 0, staged: Boolean(options.staged), diff: summarizeCommand(diff) };
}

async function gitLog(workspace, config, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 10), 1), 100);
  const args = ["log", `-${limit}`, "--date=iso", "--pretty=format:%H%x09%an%x09%ad%x09%s"];
  if (options.path) args.push("--", options.path);
  const result = await runGit(args, workspace, config);
  return {
    ok: result.exitCode === 0,
    commits: result.stdout ? result.stdout.split(/\r?\n/).map((line) => {
      const [sha, author, date, ...subjectParts] = line.split("\t");
      return { sha, author, date, subject: subjectParts.join("\t") };
    }) : [],
    result: summarizeCommand(result)
  };
}

async function gitShow(workspace, config, rev) {
  const ref = String(rev || "").trim();
  if (!ref || ref.length > 120 || /[^A-Za-z0-9._\/-]/.test(ref) || ref.includes("..")) {
    throw new Error(`Unsafe or empty git revision: ${ref}`);
  }
  const result = await runGit(["show", "--stat", "--patch", "--find-renames", ref], workspace, config);
  return { ok: result.exitCode === 0, rev: ref, result: summarizeCommand(result) };
}

async function applyPatch(workspace, config, diff, options = {}) {
  if (!String(diff || "").trim()) throw new Error("diff is required.");
  let touchedPaths = [];
  try {
    touchedPaths = validateDiffPaths(diff, workspace.path);
  } catch (error) {
    const fallback = applyLoosePatch(workspace, diff, { dryRun: Boolean(options.dryRun) });
    return {
      ok: Boolean(fallback.ok),
      dryRun: Boolean(options.dryRun),
      touchedPaths,
      message: fallback.ok
        ? fallback.message
        : `Patch path validation failed and loose fallback was not safe: ${error instanceof Error ? error.message : String(error)}`,
      patchFailureKind: "invalid_or_missing_diff_paths",
      recommendedTool: "relai_write",
      fallback
    };
  }

  const diffPath = writeTempDiff(diff);
  try {
    const check = await runGit(["apply", "--check", diffPath], workspace, config);
    const gitCheck = summarizeCommand(check);
    const result = {
      ok: false,
      dryRun: Boolean(options.dryRun),
      touchedPaths,
      gitCheck
    };
    if (check.exitCode !== 0) {
      if (isPatchParserError(gitCheck)) {
        const fallback = applyLoosePatch(workspace, diff, { dryRun: Boolean(options.dryRun) });
        return {
          ...result,
          ok: Boolean(fallback.ok),
          message: fallback.ok
            ? fallback.message
            : "Patch was malformed and the deterministic loose-context fallback could not apply it safely.",
          patchFailureKind: "malformed_unified_diff",
          recommendedTool: "relai_write",
          recommendedFlow: ["relai_read", "relai_write", "relai_verify", "relai_diff"],
          fallback
        };
      }
      result.message = "Patch did not apply cleanly.";
      result.patchFailureKind = "context_or_conflict";
      result.recommendedTool = "relai_write";
      return result;
    }
    if (options.dryRun) {
      result.ok = true;
      result.message = "Patch check passed. No files were changed.";
      return result;
    }
    const apply = await runGit(["apply", "--whitespace=warn", diffPath], workspace, config);
    result.gitApply = summarizeCommand(apply);
    result.ok = apply.exitCode === 0;
    result.message = result.ok ? "Patch applied." : "Patch check passed but git apply failed.";
    return result;
  } finally {
    try { fs.unlinkSync(diffPath); } catch (_error) {}
  }
}

async function applyPatchAndRun(workspace, config, args) {
  const patch = await applyPatch(workspace, config, args.diff, { dryRun: Boolean(args.dryRun) });
  const tests = [];
  if (!patch.ok || args.dryRun) {
    return { ok: patch.ok, patch, tests, message: args.dryRun ? "Dry run only; tests were not run." : "Patch failed; tests were not run." };
  }
  const keys = Array.isArray(args.testCommandKeys) ? args.testCommandKeys : [];
  for (const key of keys) {
    const configuredCommand = workspace.testCommands && workspace.testCommands[key];
    const discoveredCommand = configuredCommand ? null : discoverCommands(workspace.path)[key];
    const command = configuredCommand || discoveredCommand;
    if (!command) throw new Error(`Test command key '${key}' is not configured for workspace '${workspace.alias}'.`);
    const result = await runProcess(command, [], { cwd: workspace.path, shell: true, commandString: command }, config);
    tests.push({ key, command, ...summarizeCommand(result) });
    if (result.exitCode !== 0 && args.stopOnFailure !== false) break;
  }
  const ok = patch.ok && tests.every((test) => test.ok);
  return { ok, patch, tests, message: ok ? "Patch applied and requested tests passed." : "Patch applied, but one or more tests failed." };
}

function writeTempDiff(diff) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rel-ai-mcp-diff-"));
  const file = path.join(dir, "patch.diff");
  fs.writeFileSync(file, `${String(diff).trim()}\n`, { mode: 0o600 });
  return file;
}

function validateBranchName(branchName) {
  const name = String(branchName || "").trim();
  if (!name) throw new Error("branchName is required.");
  if (name.length > 160) throw new Error("branchName is too long.");
  if (!/^[A-Za-z0-9._\/-]+$/.test(name) || name.includes("..") || name.startsWith("/") || name.endsWith("/") || name.includes("//")) {
    throw new Error(`Unsafe branch name: ${name}`);
  }
  return name;
}

async function createBranch(workspace, config, branchName, options = {}) {
  const name = validateBranchName(branchName);
  if (isProtectedBranch(workspace, name)) {
    throw new Error(`Refusing to create/switch to protected branch '${name}'.`);
  }
  const args = options.fromRef ? ["switch", "-c", name, options.fromRef] : ["switch", "-c", name];
  const result = await runGit(args, workspace, config);
  return { ok: result.exitCode === 0, branch: name, result: summarizeCommand(result) };
}

async function switchBranch(workspace, config, branchName) {
  const name = validateBranchName(branchName);
  if (isProtectedBranch(workspace, name) && !workspace.allowDestructiveTools) {
    throw new Error(`Refusing to switch to protected branch '${name}' unless allowDestructiveTools is enabled for the workspace.`);
  }
  const result = await runGit(["switch", name], workspace, config);
  return { ok: result.exitCode === 0, branch: name, result: summarizeCommand(result) };
}

async function commitAll(workspace, config, message) {
  const commitMessage = String(message || "").trim();
  if (!commitMessage) throw new Error("commit message is required.");
  const current = await currentBranch(workspace, config);
  if (isProtectedBranch(workspace, current)) {
    throw new Error(`Refusing to commit directly on protected branch '${current}'. Create a feature branch first.`);
  }
  const add = await runGit(["add", "-A"], workspace, config);
  if (add.exitCode !== 0) return { ok: false, add: summarizeCommand(add), message: "git add failed." };
  const commit = await runGit(["commit", "-m", commitMessage], workspace, config);
  return { ok: commit.exitCode === 0, branch: current, commit: summarizeCommand(commit) };
}

async function pushBranch(workspace, config, remote = "origin", branchName = null) {
  const branch = branchName || await currentBranch(workspace, config);
  validateBranchName(branch);
  if (isProtectedBranch(workspace, branch)) {
    throw new Error(`Refusing to push protected branch '${branch}' through rel-ai-mcp.`);
  }
  const safeRemote = validateRemote(workspace, remote);
  const result = await runGit(["push", "-u", safeRemote, branch], workspace, config);
  return { ok: result.exitCode === 0, branch, remote: safeRemote, result: summarizeCommand(result) };
}

function validateRemote(workspace, remote) {
  const value = String(remote || "origin").trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(value)) throw new Error(`Unsafe remote name: ${value}`);
  const allowed = workspace.allowedRemotes || ["origin"];
  if (!allowed.includes(value)) throw new Error(`Remote '${value}' is not allowlisted for workspace '${workspace.alias}'.`);
  return value;
}

async function createPrWithGh(workspace, config, args) {
  if (!config.allowGitHubCli) {
    throw new Error("GitHub CLI PR creation is disabled. Set allowGitHubCli: true in config.json to enable this tool.");
  }
  const title = String(args.title || "").trim();
  const body = String(args.body || "").trim();
  const base = String(args.base || workspace.defaultBaseBranch || "main").trim();
  const head = args.head ? String(args.head).trim() : await currentBranch(workspace, config);
  if (!title) throw new Error("title is required.");
  validateBranchName(head);
  validateBranchName(base);
  const ghArgs = ["pr", "create", "--title", title, "--body", body || "Created by rel-ai-mcp.", "--base", base, "--head", head];
  if (args.draft !== false) ghArgs.push("--draft");
  if (Array.isArray(args.labels)) {
    for (const label of args.labels) ghArgs.push("--label", String(label));
  }
  if (Array.isArray(args.reviewers)) {
    for (const reviewer of args.reviewers) ghArgs.push("--reviewer", String(reviewer));
  }
  const result = await runProcess("gh", ghArgs, { cwd: workspace.path, shell: false }, config);
  return { ok: result.exitCode === 0, base, head, result: summarizeCommand(result) };
}

async function prChecksWithGh(workspace, config, args = {}) {
  if (!config.allowGitHubCli) throw new Error("GitHub CLI is disabled. Set allowGitHubCli: true in config.json.");
  const selector = args.pr ? String(args.pr) : "";
  const ghArgs = selector ? ["pr", "checks", selector, "--watch=false"] : ["pr", "checks", "--watch=false"];
  const result = await runProcess("gh", ghArgs, { cwd: workspace.path, shell: false }, config);
  return { ok: result.exitCode === 0, result: summarizeCommand(result) };
}

async function runConfiguredCommand(workspace, config, args = {}) {
  let command;
  let key = null;
  if (args.commandKey) {
    key = String(args.commandKey);
    command = workspace.commands && workspace.commands[key];
    if (!command) {
      const discovered = discoverCommands(workspace.path);
      command = discovered[key];
      if (!command) {
        const availableKeys = [
          ...Object.keys(workspace.commands || {}),
          ...Object.keys(discovered)
        ].join(", ") || "none";
        throw new Error(`Command key '${key}' is not configured for workspace '${workspace.alias}'. Available keys: ${availableKeys}.`);
      }
    }
  } else if (args.command && workspace.allowArbitraryCommands) {
    command = String(args.command);
    key = "arbitrary";
  } else {
    throw new Error("Use commandKey for configured commands, or enable allowArbitraryCommands explicitly for this workspace.");
  }
  safeCommandPolicy(command);
  const result = await runProcess(command, [], { cwd: workspace.path, shell: true, commandString: command }, config);
  return { ok: result.exitCode === 0, commandKey: key, command, ...summarizeCommand(result) };
}

module.exports = {
  runGit,
  currentBranch,
  gitStatus,
  gitDiff,
  gitLog,
  gitShow,
  applyPatch,
  applyPatchAndRun,
  validateBranchName,
  createBranch,
  switchBranch,
  commitAll,
  pushBranch,
  createPrWithGh,
  prChecksWithGh,
  runConfiguredCommand
};
