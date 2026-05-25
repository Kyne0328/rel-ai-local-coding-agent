import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, "..", "src");

// Import the pure command builders from localRepoBridge.js
const bridgePath = path.join(srcDir, "localRepoBridge.js");
const bridgeURL = pathToFileURL(bridgePath).href;
const { buildZipCommand, buildUnzipCommand } = await import(bridgeURL);

// Test buildZipCommand
console.log("Testing buildZipCommand...");

// Test 1: win32 zip command
const winZipCmd = buildZipCommand("win32", "C:/source", "C:/archive.zip");
assert.strictEqual(winZipCmd.exe, "powershell.exe");
assert.deepStrictEqual(winZipCmd.args[0], "-NoProfile");
assert.deepStrictEqual(winZipCmd.args[1], "-ExecutionPolicy");
assert.deepStrictEqual(winZipCmd.args[2], "Bypass");
assert.deepStrictEqual(winZipCmd.args[3], "-Command");
assert.ok(winZipCmd.args[4].includes("Compress-Archive"));
assert.ok(winZipCmd.args[4].includes("source") && winZipCmd.args[4].includes("*"));
assert.ok(winZipCmd.args[4].includes("archive.zip"));
console.log("  1. win32 exe and args verified");

// Test 2: win32 with spaces in path
const winZipCmdSpaces = buildZipCommand("win32", "C:/path with spaces/source", "C:/path with spaces/archive.zip");
assert.strictEqual(winZipCmdSpaces.exe, "powershell.exe");
assert.ok(winZipCmdSpaces.args[4].includes("'") && winZipCmdSpaces.args[4].includes("path with spaces"));
assert.ok(winZipCmdSpaces.args[4].includes("Compress-Archive"));
console.log("  2. win32 paths with spaces are quoted");

// Test 3: unix zip command
const unixZipCmd = buildZipCommand("linux", "/source", "/archive.zip");
assert.strictEqual(unixZipCmd.exe, "zip");
assert.deepStrictEqual(unixZipCmd.args, ["-qr", "/archive.zip", "."]);
assert.strictEqual(unixZipCmd.cwd, "/source");
console.log("  3. linux zip command correct");

// Test 4: unix with spaces in path
const unixZipCmdSpaces = buildZipCommand("linux", "/path with spaces", "/archive.zip");
assert.strictEqual(unixZipCmdSpaces.exe, "zip");
assert.deepStrictEqual(unixZipCmdSpaces.args, ["-qr", "/archive.zip", "."]);
assert.strictEqual(unixZipCmdSpaces.cwd, "/path with spaces");
console.log("  4. linux paths with spaces handled (cwd param)");

// Test 5: darwin (macOS) zip command
const macZipCmd = buildZipCommand("darwin", "/source", "/archive.zip");
assert.strictEqual(macZipCmd.exe, "zip");
assert.deepStrictEqual(macZipCmd.args, ["-qr", "/archive.zip", "."]);
console.log("  5. darwin zip command correct");

// Test buildUnzipCommand
console.log("Testing buildUnzipCommand...");

// Test 6: win32 unzip command
const winUnzipCmd = buildUnzipCommand("win32", "C:/archive.zip", "C:/dest");
assert.strictEqual(winUnzipCmd.exe, "powershell.exe");
assert.deepStrictEqual(winUnzipCmd.args[0], "-NoProfile");
assert.deepStrictEqual(winUnzipCmd.args[1], "-ExecutionPolicy");
assert.deepStrictEqual(winUnzipCmd.args[2], "Bypass");
assert.deepStrictEqual(winUnzipCmd.args[3], "-Command");
assert.ok(winUnzipCmd.args[4].includes("Expand-Archive"));
assert.ok(winUnzipCmd.args[4].includes("-LiteralPath"));
assert.ok(winUnzipCmd.args[4].includes("archive.zip"));
assert.ok(winUnzipCmd.args[4].includes("dest"));
console.log("  6. win32 unzip exe and args verified");

// Test 7: win32 unzip with spaces in path
const winUnzipCmdSpaces = buildUnzipCommand("win32", "C:/path with spaces/archive.zip", "C:/path with spaces/dest");
assert.strictEqual(winUnzipCmdSpaces.exe, "powershell.exe");
assert.ok(winUnzipCmdSpaces.args[4].includes("'") && winUnzipCmdSpaces.args[4].includes("path with spaces"));
assert.ok(winUnzipCmdSpaces.args[4].includes("Expand-Archive"));
console.log("  7. win32 unzip paths with spaces are quoted");

// Test 8: unix unzip command
const unixUnzipCmd = buildUnzipCommand("linux", "/archive.zip", "/dest");
assert.strictEqual(unixUnzipCmd.exe, "unzip");
assert.deepStrictEqual(unixUnzipCmd.args, ["-q", "/archive.zip", "-d", "/dest"]);
console.log("  8. linux unzip command correct");

// Test 9: darwin (macOS) unzip command
const macUnzipCmd = buildUnzipCommand("darwin", "/archive.zip", "/dest");
assert.strictEqual(macUnzipCmd.exe, "unzip");
assert.deepStrictEqual(macUnzipCmd.args, ["-q", "/archive.zip", "-d", "/dest"]);
console.log("  9. darwin unzip command correct");

// Test 10: Single quotes escaping in PowerShell (inside command string)
const winZipCmdQuote = buildZipCommand("win32", "C:/source/file's", "C:/archive.zip");
assert.ok(winZipCmdQuote.args[4].includes("''"));
console.log("  10. PowerShell quote escaping verified");

console.log("\nWindows archive command smoke tests passed.");
process.exit(0);
