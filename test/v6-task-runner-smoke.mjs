import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relai-v6-smoke-"));
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
  approvalGates: { patch: false, commit: false, push: false, pr: false, reset: false, "worktree-remove": false },
  worktreeRoot: path.join(tmp, "worktrees"),
  workspaces: {
    smoke: {
      path: repo,
      testCommands: { unit: "npm test" },
      commands: { repair: "node -e \"console.log('repair noop')\"" },
      protectedBranches: ["main"]
    }
  }
}, null, 2));
process.env.REL_AI_MCP_CONFIG = configPath;

const { callTool } = await import(pathToFileURL(path.join(root, "src", "tools.js")).href);

const version = await callTool("relai_version", {});
assert.equal(version.version, "0.9.0");
assert.ok(version.capabilities.includes("high-level task runner"));
assert.ok(version.toolCount >= 75);

const planOnly = await callTool("relai_task_run", {
  workspace: "smoke",
  goal: "Add multiply helper",
  mode: "plan_only",
  branchName: "relai/v6-smoke",
  testCommandKeys: ["unit"]
});
assert.equal(planOnly.ok, true);
assert.equal(planOnly.mode, "plan_only");
assert.ok(planOnly.session.id);
assert.ok(planOnly.plan.id);

const profile = await callTool("relai_repo_profile", { sessionId: planOnly.session.id });
assert.equal(profile.ok, true);
assert.ok(profile.stack.includes("node"));

const relevant = await callTool("relai_repo_relevant_files", { sessionId: planOnly.session.id, terms: ["math"], limit: 10 });
assert.equal(relevant.ok, true);
assert.ok(relevant.files.some((file) => file.path === "src/math.js"));

const suggestions = await callTool("relai_repo_test_suggestions", { sessionId: planOnly.session.id });
assert.equal(suggestions.ok, true);
assert.ok(suggestions.suggestions.some((item) => item.command === "npm test"));

const diff = `diff --git a/src/math.js b/src/math.js
--- a/src/math.js
+++ b/src/math.js
@@ -1 +1,2 @@
 export function add(a, b) { return a + b; }
+export function multiply(a, b) { return a * b; }
`;
const run = await callTool("relai_task_run", {
  workspace: "smoke",
  sessionId: planOnly.session.id,
  mode: "implement_and_test",
  patches: [diff],
  testCommandKeys: ["unit"]
});
assert.equal(run.ok, true);
assert.equal(run.cycles.length, 1);

const changed = await callTool("relai_session_changed_files", { sessionId: planOnly.session.id });
assert.equal(changed.ok, true);
assert.deepEqual(changed.files, ["src/math.js"]);

const testSummary = await callTool("relai_session_test_summary", { sessionId: planOnly.session.id });
assert.equal(testSummary.ok, true);
assert.ok(testSummary.count >= 1);

const exported = await callTool("relai_session_export", { sessionId: planOnly.session.id });
assert.equal(exported.ok, true);
assert.equal(exported.session.id, planOnly.session.id);
assert.ok(exported.diff.stdout.includes("multiply"));

const stop = await callTool("relai_task_stop", { sessionId: planOnly.session.id, reason: "smoke pause" });
assert.equal(stop.ok, true);
assert.equal(stop.session.status, "stopped");
const resume = await callTool("relai_task_resume", { sessionId: planOnly.session.id, note: "smoke resume" });
assert.equal(resume.ok, true);
assert.equal(resume.session.status, "active");

const dash = await callTool("relai_dashboard_open", { baseUrl: "http://127.0.0.1:3333" });
assert.equal(dash.ok, true);
assert.ok(dash.dashboardUrl.endsWith("/dashboard"));

const rm = await callTool("relai_task_worktree_remove", { sessionId: planOnly.session.id, force: true, closeSession: true });
assert.equal(rm.ok, true);
console.log("v6 task runner smoke passed");
