import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isSecretPath, validateRelativePath, resolveSafePath, assertPathOperationAllowed, isPathInside, collectTextFiles, writeTextFileSafe } = require("../src/safety.js");

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
  "lib/util.ts",
  ".gitignore",
  ".editorconfig",
  ".env.example",
  ".env.template",
  ".env.sample",
  ".env.defaults",
  "known_hosts"
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
assert.throws(
  () => assertPathOperationAllowed('.env', 'read'),
  (error) => error?.code === 'SENSITIVE_PATH_RESTRICTED' && error?.operation === 'read',
  'sensitive policy errors must retain operation context'
);
assert.doesNotThrow(
  () => assertPathOperationAllowed('.env', 'commit', { allowSensitive: true }),
  'explicit sensitive-path commit authorization must be narrowly supported'
);
assert.throws(
  () => assertPathOperationAllowed('.env', 'write', { allowSensitive: true }),
  /blocked sensitive path/,
  'generic allowSensitive must not authorize write operations'
);

console.log("Testing validateRelativePath — safe paths that must not throw...");
for (const p of safePaths) {
  const result = validateRelativePath(p);
  assert.equal(result, p.replaceAll("\\", "/"), `Expected validateRelativePath to return normalised path for: ${p}`);
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

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "safety-paths-outside-"));
  try {
    const externalLink = path.join(tmp, 'external-link');
    const internalTarget = path.join(tmp, 'internal-target');
    const internalLink = path.join(tmp, 'internal-link');
    fs.mkdirSync(internalTarget, { recursive: true });
    fs.symlinkSync(outside, externalLink, process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(internalTarget, internalLink, process.platform === 'win32' ? 'junction' : 'dir');

    assert.throws(
      () => resolveSafePath(tmp, 'external-link/new/file.txt'),
      /Path escapes workspace/,
      'new files below an outward symlink parent must be blocked'
    );
    assert.throws(
      () => writeTextFileSafe(tmp, 'external-link/new/file.txt', 'blocked'),
      /Path escapes workspace/,
      'writes below an outward symlink parent must be blocked'
    );

    const internalResolved = resolveSafePath(tmp, 'internal-link/new/file.txt');
    assert.ok(isPathInside(internalResolved.realPath, fs.realpathSync(tmp)), 'in-workspace symlink parents must remain usable');
    writeTextFileSafe(tmp, 'internal-link/new/file.txt', 'allowed');
    assert.equal(fs.readFileSync(path.join(internalTarget, 'new', 'file.txt'), 'utf8'), 'allowed');
    console.log("  resolveSafePath symlink-parent containment: OK");
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }

  fs.mkdirSync(path.join(tmp, '.rel-ai-mcp-state'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.rel-ai-mcp-state', 'payload.patch'), 'private runtime state');
  const collected = collectTextFiles(tmp);
  assert.ok(!collected.files.some(file => file.startsWith('.rel-ai-mcp-state/')), 'runtime state must be excluded from snapshots');

  const executable = path.join(tmp, 'run.sh');
  fs.writeFileSync(executable, '#!/bin/sh\necho old\n');
  fs.chmodSync(executable, 0o755);
  writeTextFileSafe(tmp, 'run.sh', '#!/bin/sh\necho new\n');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(executable).mode & 0o777, 0o755, 'safe replacement must preserve executable mode');
  }

  writeTextFileSafe(tmp, 'literal.json', '{"value":"line\\ntext"}');
  assert.equal(fs.readFileSync(path.join(tmp, 'literal.json'), 'utf8'), '{"value":"line\\ntext"}', 'literal escaped newlines must remain literal');

  for (const templateName of ['.env.example', '.env.template', '.env.sample', '.env.defaults']) {
    writeTextFileSafe(tmp, templateName, 'DATABASE_URL=replace-me\n');
    assert.equal(
      fs.readFileSync(path.join(tmp, templateName), 'utf8'),
      'DATABASE_URL=replace-me\n',
      `${templateName} must be writable as a public environment template`
    );
  }

  assert.throws(
    () => writeTextFileSafe(tmp, '.env', 'DATABASE_URL=secret\n'),
    /blocked sensitive path/,
    '.env must remain blocked by the current secret-bearing path policy'
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("\nSafety path tests passed.");
process.exit(0);
