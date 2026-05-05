import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relai-v4-smoke-"));
const repo = path.join(tmp, "repo");
fs.mkdirSync(repo, { recursive: true });
execFileSync("git", ["init", "-b", "main"], { cwd: repo });
execFileSync("git", ["config", "user.email", "relai@example.com"], { cwd: repo });
execFileSync("git", ["config", "user.name", "RelAI Smoke"], { cwd: repo });
fs.writeFileSync(path.join(repo, ".gitattributes"), "* text=auto eol=lf\n", "utf8");
fs.writeFileSync(path.join(repo, "README.md"), "# Smoke\n", "utf8");
fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }, null, 2), "utf8");
execFileSync("git", ["add", "-A"], { cwd: repo });
execFileSync("git", ["commit", "-m", "init"], { cwd: repo });

const configPath = path.join(tmp, "config.json");
const stateDir = path.join(tmp, "state");
fs.writeFileSync(configPath, JSON.stringify({
  stateDir,
  approvalGates: { reset: false, "worktree-remove": false, push: false, pr: false },
  permissionProfile: "admin",
  worktreeRoot: path.join(tmp, "worktrees"),
  workspaces: {
    smoke: {
      path: repo,
      testCommands: { unit: "npm test" },
      commands: { echo: "node -e \"console.log('ok')\"" },
      protectedBranches: ["main"]
    }
  }
}, null, 2));
process.env.REL_AI_MCP_CONFIG = configPath;

const { callTool } = await import(pathToFileURL(path.join(root, "src", "tools.js")).href);
const version = await callTool("relai_version", {});
assert.equal(version.ok, true);
assert.equal(version.version, "0.9.0");
assert.ok(version.capabilities.includes("worktree-per-task isolation"));

const task = await callTool("relai_task_start", { workspace: "smoke", goal: "smoke test", branch: "relai/smoke" });
assert.equal(task.ok, true);
const wt = await callTool("relai_task_worktree_create", { sessionId: task.id, branchName: "relai/smoke", fromRef: "main" });
assert.equal(wt.ok, true);
assert.ok(fs.existsSync(wt.worktreePath));

const read = await callTool("relai_read_files", { sessionId: task.id, paths: ["README.md"], includeSha256: true });
assert.equal(read.ok, true);
assert.equal(read.files.length, 1);

const diff = `diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n # Smoke\n+v4 worktree smoke\n`;
const loop = await callTool("relai_patch_test_loop", { sessionId: task.id, patches: [diff], testCommandKeys: ["unit"] });
assert.equal(loop.ok, true);

const status = await callTool("relai_git_status", { sessionId: task.id });
assert.equal(status.ok, true);
assert.match(status.branch, /relai\/smoke/);

const job = await callTool("relai_job_start_command", { workspace: "smoke", commandKey: "echo" });
assert.equal(job.ok, true);
let jobStatus;
for (let i = 0; i < 20; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  jobStatus = await callTool("relai_job_status", { jobId: job.job.id, tailBytes: 5000 });
  if (jobStatus.job.status !== "running") break;
}
assert.equal(jobStatus.ok, true);
assert.equal(jobStatus.job.status, "succeeded");

const reset = await callTool("relai_git_reset_worktree", { sessionId: task.id, clean: true });
assert.equal(reset.ok, true);
const rm = await callTool("relai_task_worktree_remove", { sessionId: task.id, force: true, closeSession: true });
assert.equal(rm.ok, true);
console.log("v4 workflow smoke passed");
