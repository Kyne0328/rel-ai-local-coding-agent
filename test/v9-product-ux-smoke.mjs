import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relai-v9-smoke-"));
const repo = path.join(tmp, "repo");
fs.mkdirSync(path.join(repo, "src"), { recursive: true });
execFileSync("git", ["init", "-b", "main"], { cwd: repo });
execFileSync("git", ["config", "user.email", "relai@example.com"], { cwd: repo });
execFileSync("git", ["config", "user.name", "RelAI Smoke"], { cwd: repo });
fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ type: "module", scripts: { test: "node -e \"process.exit(0)\"" } }, null, 2) + "\n", "utf8");
fs.writeFileSync(path.join(repo, "src", "math.js"), "export function add(a, b) { return a + b; }\n", "utf8");
execFileSync("git", ["add", "-A"], { cwd: repo });
execFileSync("git", ["commit", "-m", "init"], { cwd: repo });

const originalRelAi = path.join(tmp, "opencode.json");
fs.writeFileSync(originalRelAi, JSON.stringify({
  workspaces: {
    legacy: {
      path: repo,
      testCommands: { unit: "npm test" }
    }
  }
}, null, 2));

const configPath = path.join(tmp, "config.json");
const stateDir = path.join(tmp, "state");
fs.writeFileSync(configPath, JSON.stringify({
  version: 1,
  stateDir,
  permissionProfile: "admin",
  approvalGates: { patch: false, write: false, commit: false, push: false, pr: false, reset: false, "worktree-remove": false, merge: false },
  worktreeRoot: path.join(tmp, "worktrees"),
  productUx: { staleHours: 1, cleanupOlderThanHours: 1, liveLogPollSeconds: 1 },
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
assert.equal(version.version, pkg.version);
assert.ok(version.capabilities.includes("rich dashboard data and live audit logs"));

const setup = await callTool("relai_setup_wizard", { alias: "demo", workspacePath: repo });
assert.equal(setup.ok, true);
assert.equal(setup.config.workspaces.demo.path, repo);
assert.ok(setup.suggestedToken.length >= 32);

const fix = await callTool("relai_doctor_fix", { workspacePath: repo });
assert.equal(fix.ok, true);
assert.ok(fs.existsSync(path.join(repo, ".gitattributes")));
assert.ok(fs.existsSync(path.join(repo, ".editorconfig")));

const health = await callTool("relai_health_monitor", { limit: 50 });
assert.equal(health.ok, true);
assert.ok(health.counts.sessions >= 0);

const dashboard = await callTool("relai_dashboard_data", { limit: 50 });
assert.equal(dashboard.ok, true);
assert.ok(dashboard.counts);
assert.ok(dashboard.health);

const logs = await callTool("relai_live_log_tail", { limit: 20 });
assert.equal(logs.ok, true);
assert.ok(Array.isArray(logs.entries));

const preview = await callTool("relai_cleanup_preview", { olderThanHours: 1, maxDeletes: 10 });
assert.equal(preview.ok, true);
assert.equal(preview.dryRun, true);

const exported = await callTool("relai_state_export", { outputPath: path.join(tmp, "state-export.json") });
assert.equal(exported.ok, true);
assert.ok(fs.existsSync(exported.outputPath));

const imported = await callTool("relai_import_original_relai_config", { sourcePath: originalRelAi, dryRun: true });
assert.equal(imported.ok, true);
assert.ok(imported.imported.includes("legacy"));

const cleanup = await callTool("relai_cleanup_run", { olderThanHours: 1, maxDeletes: 5, confirm: true });
assert.equal(cleanup.ok, true);
assert.equal(cleanup.dryRun, false);

const stateImport = await callTool("relai_state_import", { inputPath: exported.outputPath, confirm: true });
assert.equal(stateImport.ok, true);
assert.ok(stateImport.writtenCount >= 0);

console.log(`v9 product UX smoke ok: ${version.toolCount} tools`);
