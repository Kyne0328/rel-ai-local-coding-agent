const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runProcess, summarizeCommand } = require("./process");
const { validateDiffPaths } = require("./safety");

function runGit(args, workspace, config) {
  return runProcess("git", args, { cwd: workspace.path, shell: false }, config);
}

async function gitStatus(workspace, config) {
  const branch = await runGit(["branch", "--show-current"], workspace, config);
  const status = await runGit(["status", "--short", "--branch"], workspace, config);
  return {
    ok: status.exitCode === 0,
    branch: branch.stdout || "",
    status: summarizeCommand(status)
  };
}

async function gitDiff(workspace, config, options = {}) {
  const args = options.staged ? ["diff", "--staged"] : ["diff"];
  if (options.path) args.push("--", options.path);
  const diff = await runGit(args, workspace, config);
  return { ok: diff.exitCode === 0, diff: summarizeCommand(diff) };
}

async function applyPatch(workspace, config, diff, options = {}) {
  if (!String(diff || "").trim()) throw new Error("diff is required.");
  const touchedPaths = validateDiffPaths(diff, workspace.path);
  const diffPath = writeTempDiff(diff);
  try {
    const check = await runGit(["apply", "--check", diffPath], workspace, config);
    const result = {
      ok: false,
      dryRun: Boolean(options.dryRun),
      touchedPaths,
      gitCheck: summarizeCommand(check)
    };
    if (check.exitCode !== 0) {
      result.message = "Patch did not apply cleanly.";
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
  if ((workspace.protectedBranches || []).includes(name)) {
    throw new Error(`Refusing to create/switch to protected branch '${name}'.`);
  }
  const args = options.fromRef ? ["switch", "-c", name, options.fromRef] : ["switch", "-c", name];
  const result = await runGit(args, workspace, config);
  return { ok: result.exitCode === 0, branch: name, result: summarizeCommand(result) };
}

async function commitAll(workspace, config, message) {
  const commitMessage = String(message || "").trim();
  if (!commitMessage) throw new Error("commit message is required.");
  const branch = await runGit(["branch", "--show-current"], workspace, config);
  const current = branch.stdout.trim();
  if ((workspace.protectedBranches || []).includes(current)) {
    throw new Error(`Refusing to commit directly on protected branch '${current}'. Create a feature branch first.`);
  }
  const add = await runGit(["add", "-A"], workspace, config);
  if (add.exitCode !== 0) return { ok: false, add: summarizeCommand(add), message: "git add failed." };
  const commit = await runGit(["commit", "-m", commitMessage], workspace, config);
  return { ok: commit.exitCode === 0, branch: current, commit: summarizeCommand(commit) };
}

async function pushBranch(workspace, config, remote = "origin", branchName = null) {
  const branch = branchName || (await runGit(["branch", "--show-current"], workspace, config)).stdout.trim();
  validateBranchName(branch);
  if ((workspace.protectedBranches || []).includes(branch)) {
    throw new Error(`Refusing to push protected branch '${branch}' through rel-ai-mcp.`);
  }
  const result = await runGit(["push", "-u", remote, branch], workspace, config);
  return { ok: result.exitCode === 0, branch, remote, result: summarizeCommand(result) };
}

async function createPrWithGh(workspace, config, args) {
  if (!config.allowGitHubCli) {
    throw new Error("GitHub CLI PR creation is disabled. Set allowGitHubCli: true in config.json to enable this tool.");
  }
  const title = String(args.title || "").trim();
  const body = String(args.body || "").trim();
  const base = String(args.base || "main").trim();
  const head = args.head ? String(args.head).trim() : (await runGit(["branch", "--show-current"], workspace, config)).stdout.trim();
  if (!title) throw new Error("title is required.");
  validateBranchName(head);
  validateBranchName(base);
  const ghArgs = ["pr", "create", "--title", title, "--body", body || "Created by rel-ai-mcp.", "--base", base, "--head", head];
  if (args.draft !== false) ghArgs.push("--draft");
  const result = await runProcess("gh", ghArgs, { cwd: workspace.path, shell: false }, config);
  return { ok: result.exitCode === 0, result: summarizeCommand(result) };
}

module.exports = {
  runGit,
  gitStatus,
  gitDiff,
  applyPatch,
  createBranch,
  commitAll,
  pushBranch,
  createPrWithGh
};
