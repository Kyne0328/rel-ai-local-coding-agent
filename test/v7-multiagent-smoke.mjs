import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relai-v7-smoke-"));
const repo = path.join(tmp, "repo");
fs.mkdirSync(path.join(repo, "src"), { recursive: true });
execFileSync("git", ["init", "-b", "main"], { cwd: repo });
execFileSync("git", ["config", "user.email", "relai@example.com"], { cwd: repo });
execFileSync("git", ["config", "user.name", "RelAI Smoke"], { cwd: repo });
fs.writeFileSync(path.join(repo, ".gitattributes"), "* text=auto eol=lf\n", "utf8");
fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ type: "module", scripts: { test: "node -e \"process.exit(0)\"" } }, null, 2));
fs.writeFileSync(path.join(repo, "src", "math.js"), "export function add(a, b) { return a + b; }\n");
execFileSync("git", ["add", "-A"], { cwd: repo });
execFileSync("git", ["commit", "-m", "init"], { cwd: repo });

const configPath = path.join(tmp, "config.json");
const stateDir = path.join(tmp, "state");
fs.writeFileSync(configPath, JSON.stringify({
  version: 1,
  stateDir,
  permissionProfile: "admin",
  approvalGates: { patch: false, commit: false, push: false, pr: false, reset: false, "worktree-remove": false, merge: false },
  worktreeRoot: path.join(tmp, "worktrees"),
  multiAgent: { enabled: true, maxSubtasks: 8, maxParallelSubtasks: 2, requireReviewBeforeMerge: true },
  workspaces: {
    smoke: {
      path: repo,
      testCommands: { unit: "npm test" },
      commands: { noop: "node -e \"console.log('noop')\"" },
      protectedBranches: ["main"]
    }
  }
}, null, 2));
process.env.REL_AI_MCP_CONFIG = configPath;

const { callTool } = await import(pathToFileURL(path.join(root, "src", "tools.js")).href);

const version = await callTool("relai_version", {});
assert.equal(version.version, "0.9.0");
assert.ok(version.capabilities.includes("multi-agent task splitting"));
assert.ok(version.toolCount >= 88);

const split = await callTool("relai_task_split", {
  workspace: "smoke",
  goal: "Add multiply helper with validation",
  branchPrefix: "relai/v7",
  subtasks: [
    { role: "planner", title: "Plan multiply change", goal: "Identify files and validation for multiply helper" },
    { role: "implementer", title: "Implement multiply helper", goal: "Add multiply helper to src/math.js", dependsOn: ["planner"] },
    { role: "reviewer", title: "Review multiply helper", goal: "Review changed files, risks, and tests", dependsOn: ["implementer"] }
  ]
});
assert.equal(split.ok, true);
assert.equal(split.subtasks.length, 3);
const parentId = split.parentSession.id;
const planner = split.subtasks.find((item) => item.role === "planner");
const implementer = split.subtasks.find((item) => item.role === "implementer");
assert.ok(planner.id);
assert.ok(implementer.id);

const graph = await callTool("relai_task_graph", { sessionId: parentId });
assert.equal(graph.ok, true);
assert.equal(graph.subtasks.length, 3);
assert.ok(graph.edges.some((edge) => edge.from === "planner"));

const plannerRun = await callTool("relai_subtask_run", {
  workspace: "smoke",
  subtaskId: planner.id,
  mode: "plan_only",
  createWorktree: true,
  branchName: "relai/v7/planner"
});
assert.equal(plannerRun.ok, true);
assert.equal(plannerRun.subtask.status, "completed");

const diff = `diff --git a/src/math.js b/src/math.js
--- a/src/math.js
+++ b/src/math.js
@@ -1 +1,2 @@
 export function add(a, b) { return a + b; }
+export function multiply(a, b) { return a * b; }
`;
const implRun = await callTool("relai_subtask_run", {
  workspace: "smoke",
  subtaskId: implementer.id,
  mode: "implement_and_test",
  createWorktree: true,
  branchName: "relai/v7/implementer",
  patches: [diff],
  testCommandKeys: ["unit"]
});
assert.equal(implRun.ok, true);
assert.equal(implRun.subtask.status, "completed");

const implFull = await callTool("relai_subtask_read", { subtaskId: implementer.id });
assert.ok(implFull.sessionId);
const review = await callTool("relai_agent_review_diff", { sessionId: implFull.sessionId });
assert.equal(review.ok, true);
assert.equal(review.review.files.includes("src/math.js"), true);
assert.ok(["low", "medium", "high"].includes(review.review.riskLevel));

const conflict = await callTool("relai_conflict_check", { workspace: "smoke", parentSessionId: parentId });
assert.equal(conflict.ok, true);
assert.equal(conflict.conflicts.length, 0);

const commit = await callTool("relai_commit_all", { sessionId: implFull.sessionId, message: "Add multiply helper" });
assert.equal(commit.ok, true);

const mergePreflight = await callTool("relai_subtask_merge_back", { workspace: "smoke", subtaskId: implementer.id, targetBranch: "main", dryRun: true });
assert.equal(mergePreflight.ok, true);
assert.equal(mergePreflight.dryRun, true);
assert.ok(mergePreflight.preflight.changedFiles.includes("src/math.js"));

const status = await callTool("relai_multiagent_status", { parentSessionId: parentId });
assert.equal(status.ok, true);
assert.ok(status.counts.completed >= 2);

const dashboard = await callTool("relai_dashboard_summary", { limit: 20 });
assert.equal(dashboard.ok, true);
assert.ok(dashboard.multiAgent.counts.completed >= 2);

await callTool("relai_task_worktree_remove", { sessionId: plannerRun.result.session.id, force: true, closeSession: true });
await callTool("relai_task_worktree_remove", { sessionId: implFull.sessionId, force: true, closeSession: true });
console.log("v7 multi-agent smoke passed");
