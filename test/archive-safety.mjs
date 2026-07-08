import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  copyWorkspaceForArchive,
  overlayDirectory,
  buildZipCommand,
  buildUnzipCommand
} = require("../src/localRepoBridge.js");

// ---------------------------------------------------------------------------
// Helper: create a temp directory and return its real path
// ---------------------------------------------------------------------------
function makeTmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// ---------------------------------------------------------------------------
// 1. Snapshot excludes .env files
// ---------------------------------------------------------------------------
console.log("Test 1: copyWorkspaceForArchive excludes .env files...");
{
  const src = makeTmp("archive-src-env-");
  const dst = makeTmp("archive-dst-env-");
  try {
    fs.writeFileSync(path.join(src, ".env"), "SECRET=1");
    fs.writeFileSync(path.join(src, ".env.local"), "SECRET_LOCAL=2");
    fs.writeFileSync(path.join(src, ".env.production"), "SECRET_PROD=3");
    fs.writeFileSync(path.join(src, "safe.txt"), "safe content");

    const result = copyWorkspaceForArchive(src, dst);

    const copiedPaths = result.files.map((f) => f.path);
    const skippedPaths = result.skipped.map((s) => s.path);

    assert.ok(!copiedPaths.includes(".env"), ".env must NOT be copied");
    assert.ok(!copiedPaths.includes(".env.local"), ".env.local must NOT be copied");
    assert.ok(!copiedPaths.includes(".env.production"), ".env.production must NOT be copied");
    assert.ok(copiedPaths.includes("safe.txt"), "safe.txt must be copied");

    // .env* should appear in skipped
    assert.ok(
      skippedPaths.some((p) => p === ".env" || p.startsWith(".env")),
      ".env* files must appear in skipped list"
    );

    console.log("  PASS: .env files excluded from copy");
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 2. Snapshot excludes .git directory
// ---------------------------------------------------------------------------
console.log("Test 2: copyWorkspaceForArchive excludes .git...");
{
  const src = makeTmp("archive-src-git-");
  const dst = makeTmp("archive-dst-git-");
  try {
    fs.mkdirSync(path.join(src, ".git"));
    fs.writeFileSync(path.join(src, ".git", "HEAD"), "ref: refs/heads/main");
    fs.writeFileSync(path.join(src, "code.js"), "console.log('hi');");

    const result = copyWorkspaceForArchive(src, dst);

    const copiedPaths = result.files.map((f) => f.path);
    const allCopied = copiedPaths.join("\n");

    assert.ok(!allCopied.includes(".git"), ".git must NOT be copied");
    assert.ok(copiedPaths.includes("code.js"), "code.js must be copied");

    console.log("  PASS: .git excluded from copy");
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 3. Snapshot excludes node_modules
// ---------------------------------------------------------------------------
console.log("Test 3: copyWorkspaceForArchive excludes node_modules...");
{
  const src = makeTmp("archive-src-nm-");
  const dst = makeTmp("archive-dst-nm-");
  try {
    fs.mkdirSync(path.join(src, "node_modules", "some-pkg"), { recursive: true });
    fs.writeFileSync(path.join(src, "node_modules", "some-pkg", "index.js"), "module.exports = {};");
    fs.writeFileSync(path.join(src, "index.js"), "require('some-pkg');");

    const result = copyWorkspaceForArchive(src, dst);

    const copiedPaths = result.files.map((f) => f.path);
    const allCopied = copiedPaths.join("\n");

    assert.ok(!allCopied.includes("node_modules"), "node_modules must NOT be copied");
    assert.ok(copiedPaths.includes("index.js"), "index.js must be copied");

    console.log("  PASS: node_modules excluded from copy");
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 4. Snapshot excludes symlinks (records them in skipped)
// ---------------------------------------------------------------------------
console.log("Test 4: copyWorkspaceForArchive skips symlinks...");
{
  const src = makeTmp("archive-src-sym-");
  const dst = makeTmp("archive-dst-sym-");
  try {
    const realFile = path.join(src, "real.txt");
    fs.writeFileSync(realFile, "real content");
    fs.writeFileSync(path.join(src, "other.txt"), "other content");

    let symlinkSupported = true;
    try {
      fs.symlinkSync(realFile, path.join(src, "link.txt"));
    } catch (_err) {
      // Symlink creation may fail without elevated privileges on Windows
      symlinkSupported = false;
      console.log("  SKIP: symlink creation not supported (requires elevated privileges on Windows)");
    }

    if (symlinkSupported) {
      const result = copyWorkspaceForArchive(src, dst);

      const copiedPaths = result.files.map((f) => f.path);
      const skippedPaths = result.skipped.map((s) => s.path);

      assert.ok(!copiedPaths.includes("link.txt"), "symlink must NOT be copied");
      assert.ok(
        skippedPaths.includes("link.txt"),
        "symlink must appear in skipped list"
      );
      assert.ok(
        result.skipped.some((s) => s.path === "link.txt" && s.reason.includes("symlink")),
        "skipped entry must have symlink reason"
      );

      console.log("  PASS: symlinks skipped and recorded");
    }
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 5. clearMissing does NOT remove protected dirs (.git, node_modules)
// ---------------------------------------------------------------------------
console.log("Test 5: overlayDirectory with clearMissing does not remove .git or node_modules...");
{
  const workspace = makeTmp("overlay-ws-");
  const sourceDir = makeTmp("overlay-src-");
  try {
    // Set up workspace with .git and node_modules
    fs.mkdirSync(path.join(workspace, ".git"));
    fs.writeFileSync(path.join(workspace, ".git", "HEAD"), "ref: refs/heads/main");
    fs.mkdirSync(path.join(workspace, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "node_modules", "pkg", "index.js"), "");
    fs.writeFileSync(path.join(workspace, "old-file.txt"), "old");

    // Source dir has only a new file (no .git, no node_modules)
    fs.writeFileSync(path.join(sourceDir, "new-file.txt"), "new");

    // Overlay with clearMissing — should NOT delete .git or node_modules
    overlayDirectory(workspace, sourceDir, { clearMissing: true });

    // .git and node_modules should still exist
    assert.ok(
      fs.existsSync(path.join(workspace, ".git")),
      ".git directory must not be removed by clearMissing"
    );
    assert.ok(
      fs.existsSync(path.join(workspace, "node_modules")),
      "node_modules must not be removed by clearMissing"
    );

    // new-file.txt should be copied
    assert.ok(
      fs.existsSync(path.join(workspace, "new-file.txt")),
      "new-file.txt must be overlaid"
    );

    // old-file.txt should be cleared (it was in workspace but not in source)
    assert.ok(
      !fs.existsSync(path.join(workspace, "old-file.txt")),
      "old-file.txt must be cleared by clearMissing"
    );

    console.log("  PASS: clearMissing does not remove .git or node_modules");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 6. buildZipCommand — win32 path with spaces uses quotePowerShell quoting
// ---------------------------------------------------------------------------
console.log("Test 6: buildZipCommand win32 — paths with spaces are quoted...");
{
  const srcDir = "C:/path with spaces/source";
  const archivePath = "C:/output path/archive.zip";

  const cmd = buildZipCommand("win32", srcDir, archivePath);

  assert.equal(cmd.exe, "powershell.exe");
  const commandString = cmd.args[4];
  assert.ok(commandString.includes("Compress-Archive"), "must use Compress-Archive");
  assert.ok(
    commandString.includes("'C:/path with spaces/source") || commandString.includes("'C:\\path with spaces"),
    `command must quote path with spaces: ${commandString}`
  );
  assert.ok(
    commandString.includes("'C:/output path/archive.zip") || commandString.includes("'C:\\output path"),
    `command must quote archive path with spaces: ${commandString}`
  );
  // Single-quote escaping means no unquoted spaces in paths
  assert.ok(commandString.includes("'"), "PowerShell quoting must use single quotes");

  console.log("  PASS: buildZipCommand win32 quotes paths with spaces");
}

// ---------------------------------------------------------------------------
// 7. buildUnzipCommand — win32 path with spaces uses quotePowerShell quoting
// ---------------------------------------------------------------------------
console.log("Test 7: buildUnzipCommand win32 — paths with spaces are quoted...");
{
  const archivePath = "C:/download path/my archive.zip";
  const destination = "C:/extract path/output folder";

  const cmd = buildUnzipCommand("win32", archivePath, destination);

  assert.equal(cmd.exe, "powershell.exe");
  const commandString = cmd.args[4];
  assert.ok(commandString.includes("Expand-Archive"), "must use Expand-Archive");
  assert.ok(commandString.includes("-LiteralPath"), "must use -LiteralPath");
  assert.ok(
    commandString.includes("'C:/download path/my archive.zip") ||
    commandString.includes("'C:\\download path"),
    `command must quote archive path with spaces: ${commandString}`
  );
  assert.ok(
    commandString.includes("'C:/extract path/output folder") ||
    commandString.includes("'C:\\extract path"),
    `command must quote destination path with spaces: ${commandString}`
  );
  assert.ok(commandString.includes("'"), "PowerShell quoting must use single quotes");

  console.log("  PASS: buildUnzipCommand win32 quotes paths with spaces");
}

console.log("\nArchive safety tests passed.");
process.exit(0);
