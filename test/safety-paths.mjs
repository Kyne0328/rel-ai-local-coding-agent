import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isSecretPath, validateRelativePath, resolveSafePath } = require("../src/safety.js");

// ---------------------------------------------------------------------------
// isSecretPath — paths that MUST be blocked
// ---------------------------------------------------------------------------
const secretPaths = [
  ".env",
  ".env.local",
  ".env.production",
  ".ssh/id_rsa",
  "id_rsa",
  "id_ed25519",
  "known_hosts",
  "server.pem",
  "server.key",
  "bundle.p12",
  "bundle.pfx",
  "secrets/api.json",
  "credentials/aws.json",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "firebase-adminsdk-abc.json",
  "service-account-prod.json",
  ".aws/credentials",
  ".azure/config",
  "gcloud/credentials",
  ".kube/config",
  "kubeconfig"
];

console.log("Testing isSecretPath — blocked paths...");
for (const p of secretPaths) {
  assert.ok(isSecretPath(p), `Expected isSecretPath to return true for: ${p}`);
  console.log(`  BLOCKED: ${p}`);
}

// ---------------------------------------------------------------------------
// isSecretPath — safe paths that must NOT be blocked
// ---------------------------------------------------------------------------
const safePaths = [
  "src/index.js",
  "README.md",
  "package.json",
  "lib/util.ts"
];

console.log("Testing isSecretPath — safe paths...");
for (const p of safePaths) {
  assert.ok(!isSecretPath(p), `Expected isSecretPath to return false for: ${p}`);
  console.log(`  ALLOWED: ${p}`);
}

// ---------------------------------------------------------------------------
// validateRelativePath — traversal / absolute paths that must throw
// ---------------------------------------------------------------------------
const traversalPaths = [
  "../x",
  "a/../../x",
  "/a/b",
  "C:/x",
  "a//b"
];

console.log("Testing validateRelativePath — traversal / absolute paths that must throw...");
for (const p of traversalPaths) {
  assert.throws(
    () => validateRelativePath(p),
    (err) => err instanceof Error,
    `Expected validateRelativePath to throw for: ${p}`
  );
  console.log(`  THREW: ${p}`);
}

// ---------------------------------------------------------------------------
// validateRelativePath — safe paths must not throw
// ---------------------------------------------------------------------------
console.log("Testing validateRelativePath — safe paths that must not throw...");
for (const p of safePaths) {
  const result = validateRelativePath(p);
  assert.equal(result, p.replace(/\\/g, "/"), `Expected validateRelativePath to return normalised path for: ${p}`);
  console.log(`  OK: ${p}`);
}

// ---------------------------------------------------------------------------
// resolveSafePath — real temp dir tests
// ---------------------------------------------------------------------------
console.log("Testing resolveSafePath...");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "safety-paths-test-"));
try {
  // Create a real file inside the temp dir
  fs.writeFileSync(path.join(tmp, "hello.txt"), "hello");

  // 1. Valid relative path resolves correctly
  const resolved = resolveSafePath(tmp, "hello.txt");
  assert.equal(resolved.relativePath, "hello.txt");
  assert.ok(
    resolved.absolutePath.endsWith("hello.txt"),
    `absolutePath should end with hello.txt, got: ${resolved.absolutePath}`
  );
  console.log("  resolveSafePath valid path: OK");

  // 2. ../outside must throw
  assert.throws(
    () => resolveSafePath(tmp, "../outside"),
    (err) => err instanceof Error,
    "Expected resolveSafePath to throw for ../outside"
  );
  console.log("  resolveSafePath ../outside: threw as expected");

  // 3. /absolute/path must throw
  assert.throws(
    () => resolveSafePath(tmp, "/absolute/path"),
    (err) => err instanceof Error,
    "Expected resolveSafePath to throw for /absolute/path"
  );
  console.log("  resolveSafePath /absolute/path: threw as expected");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("\nSafety path tests passed.");
process.exit(0);
