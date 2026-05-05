import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relai-v5-smoke-"));
const repo = path.join(tmp, "repo");
fs.mkdirSync(repo, { recursive: true });
execFileSync("git", ["init", "-b", "main"], { cwd: repo });
execFileSync("git", ["config", "user.email", "relai@example.com"], { cwd: repo });
execFileSync("git", ["config", "user.name", "RelAI Smoke"], { cwd: repo });
fs.writeFileSync(path.join(repo, ".gitattributes"), "* text=auto eol=lf\n", "utf8");
fs.mkdirSync(path.join(repo, "src"));
fs.writeFileSync(path.join(repo, "README.md"), "# Smoke\n", "utf8");
fs.writeFileSync(path.join(repo, "src", "add.js"), "export function add(a, b) { return a + b; }\n", "utf8");
fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ type: "module", scripts: { test: "node -e \"process.exit(0)\"" } }, null, 2), "utf8");
execFileSync("git", ["add", "-A"], { cwd: repo });
execFileSync("git", ["commit", "-m", "init"], { cwd: repo });

const configPath = path.join(tmp, "config.json");
const stateDir = path.join(tmp, "state");
fs.writeFileSync(configPath, JSON.stringify({
  stateDir,
  permissionProfile: "admin",
  approvalGates: { commit: true, push: false, pr: false, reset: false, "worktree-remove": false },
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
assert.ok(version.capabilities.includes("persistent implementation plans"));
assert.ok(version.toolCount >= 50);

const boot = await callTool("relai_task_bootstrap", {
  workspace: "smoke",
  goal: "Add subtract helper",
  branchName: "relai/v5-smoke",
  testCommandKeys: ["unit"]
});
assert.equal(boot.ok, true);
assert.ok(boot.session.id);
assert.ok(boot.plan.id);
assert.ok(boot.worktree.ok);
assert.ok(boot.index.fileCount >= 3);

const planList = await callTool("relai_plan_list", { sessionId: boot.session.id });
assert.equal(planList.ok, true);
assert.equal(planList.plans.length, 1);

const indexSearch = await callTool("relai_index_search", { sessionId: boot.session.id, query: "add" });
assert.equal(indexSearch.ok, true);
assert.ok(indexSearch.matches.some((file) => file.path === "src/add.js"));

const lock = await callTool("relai_lock_acquire", { workspace: "smoke", resource: "src/add.js", sessionId: boot.session.id });
assert.equal(lock.ok, true);
const locks = await callTool("relai_lock_list", {});
assert.equal(locks.ok, true);
assert.ok(locks.locks.some((item) => item.id === lock.lock.id));

const approval = await callTool("relai_approval_request", {
  action: "commit",
  workspace: "smoke",
  sessionId: boot.session.id,
  summary: "Commit smoke test changes"
});
assert.equal(approval.ok, true);
const approved = await callTool("relai_approval_resolve", { approvalId: approval.id, status: "approved", note: "smoke" });
assert.equal(approved.status, "approved");

const diff = `diff --git a/src/add.js b/src/add.js\n--- a/src/add.js\n+++ b/src/add.js\n@@ -1 +1,2 @@\n export function add(a, b) { return a + b; }\n+export function subtract(a, b) { return a - b; }\n`;
const loop = await callTool("relai_patch_test_loop", { sessionId: boot.session.id, patches: [diff], testCommandKeys: ["unit"] });
assert.equal(loop.ok, true);

const commit = await callTool("relai_commit_all", { sessionId: boot.session.id, message: "Add subtract helper", approvalId: approval.id });
assert.equal(commit.ok, true);

const dashboard = await callTool("relai_dashboard_summary", { limit: 10 });
assert.equal(dashboard.ok, true);
assert.ok(dashboard.sessions.length >= 1);
assert.ok(dashboard.approvals.length >= 1);

const release = await callTool("relai_lock_release", { workspace: "smoke", resource: "src/add.js", lockId: lock.lock.id });
assert.equal(release.ok, true);
const rm = await callTool("relai_task_worktree_remove", { sessionId: boot.session.id, force: true, closeSession: true });
assert.equal(rm.ok, true);
console.log("v5 orchestration smoke passed");
