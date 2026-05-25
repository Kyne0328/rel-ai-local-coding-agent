import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { relaiApplyPatch, relaiApplyArchive, relaiSnapshotArchive } = require(
  path.join(__dirname, "..", "src", "localRepoBridge.js")
);

// --- Setup: temp workspace ---
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rel-ai-prepared-smoke-"));
const workspacePath = path.join(temp, "workspace");
const stateDir = path.join(temp, "state");
fs.mkdirSync(workspacePath, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });

// Init git repo
execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
execFileSync("git", ["config", "user.email", "relai@example.test"], { cwd: workspacePath });
execFileSync("git", ["config", "user.name", "RelAI Prepared Smoke"], { cwd: workspacePath });
execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: workspacePath, stdio: "ignore" });

// Create and commit a small text file
fs.writeFileSync(path.join(workspacePath, "hello.txt"), "Hello, world!\n");
execFileSync("git", ["add", "hello.txt"], { cwd: workspacePath });
execFileSync("git", ["commit", "-m", "add hello.txt"], { cwd: workspacePath, stdio: "ignore" });

// Build a minimal config object (standard mode — tools must work without requiring "prepared")
const config = {
  stateDir,
  workflow: {
    mode: "standard",
    prepared: {
      backup: false,
      requireCleanGit: false,
      clearMissingDefault: false,
      maxUpdateBytes: 2 * 1024 * 1024,
      maxBundleBytes: 250 * 1024 * 1024
    }
  },
  workspaces: {
    smoke: {
      path: workspacePath,
      testCommands: {},
      commands: {},
      protectedBranches: ["main", "master"],
      defaultBaseBranch: "main",
      allowedRemotes: ["origin"],
      repoSlug: "",
      fastTask: { enabled: false }
    }
  }
};

const workspace = {
  alias: "smoke",
  path: workspacePath,
  testCommands: {},
  commands: {},
  protectedBranches: ["main", "master"],
  defaultBaseBranch: "main",
  allowedRemotes: ["origin"],
  repoSlug: "",
  fastTask: { enabled: false }
};

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exit(1);
  }
}

async function testThrows(name, fn, expectedMessage) {
  try {
    await fn();
    console.error(`  FAIL: ${name} — expected an error but none was thrown`);
    process.exit(1);
  } catch (error) {
    if (expectedMessage && !error.message.includes(expectedMessage)) {
      console.error(`  FAIL: ${name} — wrong error message`);
      console.error(`    Expected to contain: ${expectedMessage}`);
      console.error(`    Got: ${error.message}`);
      process.exit(1);
    }
    passed++;
    console.log(`  ok: ${name} (threw: ${error.message.slice(0, 80)})`);
  }
}

// --- Test 1: relaiApplyPatch with a valid patch ---
await test("relaiApplyPatch applies a valid patch in standard mode", async () => {
  // Modify hello.txt so we have a diff
  fs.writeFileSync(path.join(workspacePath, "hello.txt"), "Hello, updated world!\n");
  const diff = execFileSync("git", ["diff", "hello.txt"], { cwd: workspacePath }).toString("utf8");
  // Restore to committed state
  execFileSync("git", ["checkout", "--", "hello.txt"], { cwd: workspacePath });

  // Now apply the patch
  const result = await relaiApplyPatch(workspace, config, { patch: diff, returnDiff: false });
  if (!result.ok) throw new Error(`relaiApplyPatch returned ok=false: ${JSON.stringify(result)}`);
  const content = fs.readFileSync(path.join(workspacePath, "hello.txt"), "utf8");
  if (!content.includes("updated world")) throw new Error("Patch was not applied to the file");

  // Restore
  execFileSync("git", ["checkout", "--", "hello.txt"], { cwd: workspacePath });
});

// --- Test 2: empty patch fails with correct error ---
await testThrows(
  "relaiApplyPatch rejects empty patch",
  () => relaiApplyPatch(workspace, config, { patch: "   " }),
  "relai_apply_update requires patch or diff text"
);

// --- Test 3: oversized patch fails with the right error ---
await testThrows(
  "relaiApplyPatch rejects oversized patch",
  () => {
    const tinyConfig = {
      ...config,
      workflow: {
        ...config.workflow,
        prepared: { ...config.workflow.prepared, maxUpdateBytes: 10 }
      }
    };
    const bigPatch = "x".repeat(20);
    // We need it to pass the empty check but fail the size check
    // Use a real-looking (but wrong) patch — the size check runs first
    return relaiApplyPatch(workspace, tinyConfig, { patch: bigPatch });
  },
  "relai_apply_update refused"
);

// --- Test 4: relaiSnapshotArchive + relaiApplyArchive round-trip ---
await test("relaiSnapshotArchive + relaiApplyArchive round-trip in standard mode", async () => {
  // Snapshot the workspace
  const snapshot = await relaiSnapshotArchive(workspace, config, { maxFiles: 100 });
  if (!snapshot.ok) throw new Error(`relaiSnapshotArchive returned ok=false: ${JSON.stringify(snapshot)}`);
  if (!snapshot.archivePath) throw new Error("relaiSnapshotArchive did not return archivePath");

  // Modify the file so the bundle overlay will change it back
  fs.writeFileSync(path.join(workspacePath, "hello.txt"), "Overwritten by test.\n");

  // Apply the bundle (which contains the original committed content)
  const applied = await relaiApplyArchive(workspace, config, {
    bundlePath: snapshot.archivePath,
    backup: false,
    returnDiff: false
  });
  if (!applied.ok) throw new Error(`relaiApplyArchive returned ok=false: ${JSON.stringify(applied)}`);
  if (!applied.changedFiles.includes("hello.txt")) {
    throw new Error(`relaiApplyArchive should have restored hello.txt. changedFiles: ${applied.changedFiles.join(", ")}`);
  }
  const content = fs.readFileSync(path.join(workspacePath, "hello.txt"), "utf8");
  if (!content.includes("Hello, world!")) throw new Error("relaiApplyArchive did not restore file content");
});

// --- Test 5: relaiApplyArchive with missing bundlePath ---
await testThrows(
  "relaiApplyArchive rejects missing bundlePath",
  () => relaiApplyArchive(workspace, config, { bundlePath: "" }),
  "relai_apply_bundle requires bundlePath"
);

// --- Test 6: relaiApplyArchive with non-existent archive path ---
await testThrows(
  "relaiApplyArchive rejects non-existent archive",
  () => relaiApplyArchive(workspace, config, { bundlePath: path.join(temp, "nonexistent.zip") }),
  "Archive not found"
);

// --- Test 7: relaiApplyArchive rejects oversized archive ---
await testThrows(
  "relaiApplyArchive rejects archive exceeding maxBundleBytes",
  async () => {
    const tinyConfig = {
      ...config,
      workflow: {
        ...config.workflow,
        prepared: { ...config.workflow.prepared, maxBundleBytes: 1 }
      }
    };
    // Get a real archive path (any file will do as long as it exists)
    const snapshot = await relaiSnapshotArchive(workspace, config, { maxFiles: 10 });
    return relaiApplyArchive(workspace, tinyConfig, {
      bundlePath: snapshot.archivePath,
      backup: false
    });
  },
  "relai_apply_bundle refused"
);

// Cleanup
try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_e) {}

console.log(`\nPrepared update smoke test passed. (${passed} tests)`);
