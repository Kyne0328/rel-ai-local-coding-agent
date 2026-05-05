import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relai-v8-smoke-"));
const repo = path.join(tmp, "repo");
fs.mkdirSync(path.join(repo, "src"), { recursive: true });
execFileSync("git", ["init", "-b", "main"], { cwd: repo });
execFileSync("git", ["config", "user.email", "relai@example.com"], { cwd: repo });
execFileSync("git", ["config", "user.name", "RelAI Smoke"], { cwd: repo });
fs.writeFileSync(path.join(repo, ".gitattributes"), "* text=auto eol=lf\n", "utf8");
fs.writeFileSync(path.join(repo, ".editorconfig"), "root = true\n[*]\nend_of_line = lf\n", "utf8");
fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ type: "module", scripts: { test: "node -e \"process.exit(0)\"" } }, null, 2) + "\n", "utf8");
fs.writeFileSync(path.join(repo, "src", "math.js"), "export function add(a, b) { return a + b; }\n", "utf8");
execFileSync("git", ["add", "-A"], { cwd: repo });
execFileSync("git", ["commit", "-m", "init"], { cwd: repo });

const configPath = path.join(tmp, "config.json");
const stateDir = path.join(tmp, "state");
fs.writeFileSync(configPath, JSON.stringify({
  version: 1,
  stateDir,
  permissionProfile: "admin",
  approvalGates: { patch: false, write: false, commit: false, push: false, pr: false, reset: false, "worktree-remove": false, merge: false },
  worktreeRoot: path.join(tmp, "worktrees"),
  multiAgent: { enabled: true, maxSubtasks: 6, maxParallelSubtasks: 2 },
  semanticIndex: { enabled: true, maxFiles: 200, maxFileBytes: 200000 },
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
assert.equal(version.version, "0.10.0");
assert.ok(version.capabilities.includes("dependency-aware multi-agent scheduler"));

const doctor = await callTool("relai_doctor", { workspacePath: repo });
assert.equal(doctor.lineEnding.ok, true);

const policy = await callTool("relai_policy_evaluate", { action: "push" });
assert.equal(policy.approvalRequired, false);

const memory = await callTool("relai_memory_write", { workspace: "smoke", type: "architecture", title: "Math module", text: "src/math.js contains small arithmetic helpers.", tags: ["math"] });
assert.equal(memory.ok, true);
const memorySearch = await callTool("relai_memory_search", { workspace: "smoke", query: "arithmetic" });
assert.equal(memorySearch.notes.length, 1);

const semBuild = await callTool("relai_semantic_index_build", { workspace: "smoke" });
assert.equal(semBuild.ok, true);
const semSearch = await callTool("relai_semantic_search", { workspace: "smoke", query: "add math" });
assert.ok(semSearch.matches.some((item) => item.path === "src/math.js"));
const context = await callTool("relai_context_recommend", { workspace: "smoke", goal: "change add helper", limit: 5 });
assert.ok(context.recommendedFiles.some((item) => item.path === "src/math.js"));

const snapshot = await callTool("relai_snapshot_create", { workspace: "smoke", title: "Before smoke edit" });
assert.equal(snapshot.ok, true);
const snapshotList = await callTool("relai_snapshot_list", { workspace: "smoke" });
assert.ok(snapshotList.snapshots.some((item) => item.id === snapshot.snapshot.id));

await callTool("relai_write_file", { workspace: "smoke", path: "src/math.js", content: "export function add(a, b) { return a + b; }\nexport function multiply(a, b) { return a * b; }\n" });
const review = await callTool("relai_review_score", { workspace: "smoke", goal: "add multiply helper" });
assert.equal(review.ok, true);
assert.ok(review.files.includes("src/math.js"));

const parent = await callTool("relai_task_start", { workspace: "smoke", goal: "multi-agent smoke" });
const split = await callTool("relai_task_split", { workspace: "smoke", sessionId: parent.id, count: 3, createWorktrees: false });
assert.equal(split.ok, true);
const scheduler = await callTool("relai_scheduler_start", { parentSessionId: parent.id, maxParallel: 2 });
assert.equal(scheduler.ok, true);
assert.ok(scheduler.schedule.runnable.length >= 1);
const mergePlan = await callTool("relai_merge_plan", { workspace: "smoke", parentSessionId: parent.id });
assert.equal(typeof mergePlan.ok, "boolean");

const snapDry = await callTool("relai_snapshot_restore", { workspace: "smoke", snapshotId: snapshot.snapshot.id, dryRun: true });
assert.equal(snapDry.dryRun, true);

console.log(`v8 production smoke ok: ${version.toolCount} tools`);
