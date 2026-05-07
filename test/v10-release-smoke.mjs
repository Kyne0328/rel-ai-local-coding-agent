import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relai-v10-smoke-"));
const repo = path.join(tmp, "repo");
fs.mkdirSync(path.join(repo, "src"), { recursive: true });
execFileSync("git", ["init", "-b", "main"], { cwd: repo });
execFileSync("git", ["config", "user.email", "relai@example.com"], { cwd: repo });
execFileSync("git", ["config", "user.name", "RelAI Smoke"], { cwd: repo });
fs.writeFileSync(path.join(repo, ".gitattributes"), "* text=auto eol=lf\n", "utf8");
fs.writeFileSync(path.join(repo, ".editorconfig"), "root = true\n\n[*]\nend_of_line = lf\n", "utf8");
fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ type: "module", scripts: { test: "node -e \"process.exit(0)\"" } }, null, 2) + "\n", "utf8");
fs.writeFileSync(path.join(repo, "src", "math.js"), "export function add(a, b) { return a + b; }\n", "utf8");
execFileSync("git", ["add", "-A"], { cwd: repo });
execFileSync("git", ["commit", "-m", "init"], { cwd: repo });

const configPath = path.join(tmp, "config.json");
const stateDir = path.join(tmp, "state");
fs.writeFileSync(configPath, JSON.stringify({
  version: 1,
  stateDir,
  auditLogPath: path.join(stateDir, "audit.jsonl"),
  permissionProfile: "admin",
  approvalGates: { patch: false, write: false, commit: false, push: true, pr: true, reset: true, "worktree-remove": true, merge: true },
  worktreeRoot: path.join(tmp, "worktrees"),
  release: { minimumReadinessScore: 80, requireHttpToken: true, connectorProbeTimeoutMs: 1000, enableReleaseEndpoints: true },
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
process.env.REL_AI_MCP_TOKEN = "test-token-for-v10";

const { callTool } = await import(pathToFileURL(path.join(root, "src", "tools.js")).href);

const version = await callTool("relai_version", {});
assert.equal(version.version, pkg.version);
assert.ok(version.capabilities.includes("release readiness scoring"));

const readiness = await callTool("relai_release_readiness", { requireHttpToken: true });
assert.equal(readiness.ok, true);
assert.ok(readiness.score >= 60);
assert.ok(Array.isArray(readiness.workspaces));

const workspaces = await callTool("relai_workspace_list", {});
assert.equal(workspaces.ok, true);
assert.ok(workspaces.workspaces.some((item) => item.alias === "smoke"));

const inspect = await callTool("relai_workspace_inspect", { workspace: "smoke", maxEntries: 50 });
assert.equal(inspect.ok, true);
assert.equal(inspect.workspace, "smoke");
assert.ok(inspect.profile.manifests.includes("package.json"));
assert.ok(inspect.tree.files.includes("package.json"));

const missingInspect = await callTool("relai_workspace_inspect", { workspace: "jjclover", maxEntries: 50 });
assert.equal(missingInspect.ok, false);
assert.ok(missingInspect.availableWorkspaces.some((item) => item.alias === "smoke"));

const prConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
prConfig.permissionProfile = "pr";
fs.writeFileSync(configPath, JSON.stringify(prConfig, null, 2), "utf8");
const prWorkspaces = await callTool("relai_workspace_list", {});
assert.equal(prWorkspaces.ok, true);
const prInspect = await callTool("relai_workspace_inspect", { workspace: "smoke", maxEntries: 50 });
assert.equal(prInspect.ok, true);
assert.equal(prInspect.workspace, "smoke");
prConfig.permissionProfile = "admin";
fs.writeFileSync(configPath, JSON.stringify(prConfig, null, 2), "utf8");

const preflight = await callTool("relai_workspace_preflight", { workspace: "smoke", requireClean: true });
assert.equal(preflight.ok, true);
assert.equal(preflight.workspace, "smoke");
assert.ok(preflight.testCommandKeys.includes("unit"));

const connector = await callTool("relai_connector_check", { endpoint: "http://127.0.0.1:3333/mcp", token: "abc", probe: false });
assert.equal(connector.ok, true);
assert.equal(connector.suggestedChatGPTConnector.authentication, "No Authentication");
assert.ok(connector.curl.includes("/health"));

const migration = await callTool("relai_config_migration_plan", { fromVersion: "0.9.0" });
assert.equal(migration.ok, true);
assert.equal(migration.toVersion, pkg.version);
assert.ok(Array.isArray(migration.missingKeysInCurrentConfig));

const manifest = await callTool("relai_release_manifest", { maxFiles: 5000, maxFileBytes: 1048576 });
assert.equal(manifest.ok, true);
assert.equal(manifest.version, pkg.version);
assert.ok(manifest.files.some((item) => item.path === "package.json"));

const notes = await callTool("relai_release_notes", {});
assert.equal(notes.ok, true);
assert.equal(notes.version, pkg.version);
assert.ok(notes.commitMessage.includes("workspace diagnostics"));

console.log(`v10 release smoke ok: ${version.toolCount} tools, readiness ${readiness.score}`);
