# JSON Parse Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap all unguarded `JSON.parse(fs.readFileSync(...))` calls in try-catch via a shared `safeReadJson` helper, fix a hardcoded test token, and fix a shell injection surface in `commandExists`.

**Architecture:** Add `safeReadJson(file, fallback = null)` to `src/safety.js`. For single-item reads that already throw on "not found", use `safeReadJson(file)` then throw a descriptive error on `null`. For registry/collection reads, pass a safe empty fallback. Update all 16 call sites across 14 files.

**Tech Stack:** Node.js (CommonJS), `node:fs`, no new dependencies.

---

## Task 1: Add `safeReadJson` to `src/safety.js` and write unit tests

**Files:**
- Modify: `src/safety.js`
- Create: `test/unit-safe-read-json.mjs`

- [ ] **Step 1: Write the failing unit test**

Create `test/unit-safe-read-json.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { safeReadJson } = require('../src/safety.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-read-json-'));

// valid JSON
const validFile = path.join(tmp, 'valid.json');
fs.writeFileSync(validFile, '{"ok":true,"count":3}');
const result = safeReadJson(validFile);
assert.deepEqual(result, { ok: true, count: 3 }, 'valid JSON parsed correctly');

// malformed JSON
const badFile = path.join(tmp, 'bad.json');
fs.writeFileSync(badFile, '{broken json{{');
const warned = [];
const orig = console.warn;
console.warn = (...args) => warned.push(args.join(' '));
const badResult = safeReadJson(badFile);
console.warn = orig;
assert.equal(badResult, null, 'malformed JSON returns null');
assert.ok(warned.length > 0, 'warning logged on bad JSON');
assert.ok(warned[0].includes(badFile), 'warning includes file path');

// missing file
const missingFile = path.join(tmp, 'missing.json');
const warned2 = [];
console.warn = (...args) => warned2.push(args.join(' '));
const missingResult = safeReadJson(missingFile);
console.warn = orig;
assert.equal(missingResult, null, 'missing file returns null');
assert.ok(warned2.length > 0, 'warning logged for missing file');

// empty file
const emptyFile = path.join(tmp, 'empty.json');
fs.writeFileSync(emptyFile, '');
const warned3 = [];
console.warn = (...args) => warned3.push(args.join(' '));
const emptyResult = safeReadJson(emptyFile);
console.warn = orig;
assert.equal(emptyResult, null, 'empty file returns null');

// custom fallback
const fallbackResult = safeReadJson(missingFile, { default: true });
assert.deepEqual(fallbackResult, { default: true }, 'custom fallback returned on error');

fs.rmSync(tmp, { recursive: true });
console.log('safeReadJson unit tests passed.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/unit-safe-read-json.mjs`

Expected: `TypeError: safeReadJson is not a function` (or similar — function not exported yet)

- [ ] **Step 3: Add `safeReadJson` to `src/safety.js`**

In `src/safety.js`, add the function before the `module.exports` block (after the `safeCommandPolicy` function at line 236):

```js
function safeReadJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.warn(`[rel-ai-mcp] Failed to read JSON at ${file}: ${err.message}`);
    return fallback;
  }
}
```

In `src/safety.js`, add `safeReadJson` to the `module.exports` object:

```js
module.exports = {
  SECRET_PATH_PATTERNS,
  DEFAULT_EXCLUDED_NAMES,
  validateRelativePath,
  resolveSafePath,
  isPathInside,
  isSecretPath,
  looksBinary,
  extractPathsFromDiff,
  validateDiffPaths,
  collectTextFiles,
  readTextFileSafe,
  writeTextFileSafe,
  fileSha256,
  safeCommandPolicy,
  safeReadJson
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/unit-safe-read-json.mjs`

Expected: `safeReadJson unit tests passed.`

- [ ] **Step 5: Commit**

```bash
git add src/safety.js test/unit-safe-read-json.mjs
git commit -m "feat: add safeReadJson utility to safety.js with unit tests"
```

---

## Task 2: Fix `src/approvals.js`, `src/jobs.js`, `src/sessions.js`, `src/snapshots.js`

These all follow the same pattern: file-exists check then bare `JSON.parse`. If file exists but is corrupt, add a descriptive throw instead of a crash.

**Files:**
- Modify: `src/approvals.js`, `src/jobs.js`, `src/sessions.js`, `src/snapshots.js`

- [ ] **Step 1: Fix `src/approvals.js`**

Add import at top of file (after existing requires):
```js
const { safeReadJson } = require("./safety");
```

Replace `readApproval` function (lines 55–59):
```js
function readApproval(config, approvalId) {
  const file = approvalPath(config, approvalId);
  if (!fs.existsSync(file)) throw new Error(`Approval not found: ${approvalId}`);
  const data = safeReadJson(file);
  if (!data) throw new Error(`Approval file corrupted: ${approvalId}`);
  return data;
}
```

- [ ] **Step 2: Fix `src/jobs.js`**

`src/jobs.js` already imports `safeCommandPolicy` from `./safety`. Update that destructure to also include `safeReadJson`:
```js
const { safeCommandPolicy, safeReadJson } = require("./safety");
```

Replace `readJob` function (lines 28–32):
```js
function readJob(config, jobId) {
  const file = jobPath(config, jobId);
  if (!fs.existsSync(file)) throw new Error(`Job not found: ${jobId}`);
  const data = safeReadJson(file);
  if (!data) throw new Error(`Job file corrupted: ${jobId}`);
  return data;
}
```

- [ ] **Step 3: Fix `src/sessions.js`**

Add import at top of file (after existing requires):
```js
const { safeReadJson } = require("./safety");
```

Replace `readSession` function (lines 43–47):
```js
function readSession(config, sessionId) {
  const file = sessionPath(config, sessionId);
  if (!fs.existsSync(file)) throw new Error(`Session not found: ${sessionId}`);
  const data = safeReadJson(file);
  if (!data) throw new Error(`Session file corrupted: ${sessionId}`);
  return data;
}
```

- [ ] **Step 4: Fix `src/snapshots.js`**

Add import at top of file (after existing requires):
```js
const { safeReadJson } = require("./safety");
```

Replace `readSnapshot` function (lines 55–59):
```js
function readSnapshot(config, id) {
  const file = snapshotPath(config, id);
  if (!fs.existsSync(file)) throw new Error(`Snapshot not found: ${id}`);
  const data = safeReadJson(file);
  if (!data) throw new Error(`Snapshot file corrupted: ${id}`);
  return data;
}
```

- [ ] **Step 5: Smoke test**

Run: `node test/smoke.mjs`

Expected: exits 0 with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/approvals.js src/jobs.js src/sessions.js src/snapshots.js
git commit -m "fix: wrap JSON.parse in safeReadJson for approvals, jobs, sessions, snapshots"
```

---

## Task 3: Fix `src/plans.js` and `src/multiagent.js`

**Files:**
- Modify: `src/plans.js`, `src/multiagent.js`

- [ ] **Step 1: Fix `src/plans.js`**

Add import at top of file (after existing requires):
```js
const { safeReadJson } = require("./safety");
```

Replace `readPlan` function (lines 69–73):
```js
function readPlan(config, planId) {
  const file = planPath(config, planId);
  if (!fs.existsSync(file)) throw new Error(`Plan not found: ${planId}`);
  const data = safeReadJson(file);
  if (!data) throw new Error(`Plan file corrupted: ${planId}`);
  return data;
}
```

- [ ] **Step 2: Fix `src/multiagent.js`**

Add import at top of file (after existing requires, before line 1 requires):
```js
const { safeReadJson } = require("./safety");
```

Replace `readSubtask` function (lines 42–46):
```js
function readSubtask(config, subtaskId) {
  const file = subtaskPath(config, subtaskId);
  if (!fs.existsSync(file)) throw new Error(`Subtask not found: ${subtaskId}`);
  const data = safeReadJson(file);
  if (!data) throw new Error(`Subtask file corrupted: ${subtaskId}`);
  return data;
}
```

- [ ] **Step 3: Smoke test**

Run: `node test/smoke.mjs`

Expected: exits 0 with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/plans.js src/multiagent.js
git commit -m "fix: wrap JSON.parse in safeReadJson for plans and multiagent subtasks"
```

---

## Task 4: Fix `src/locks.js`

`locks.js` has two bare parses in different contexts: one in `acquireLock` (reading an existing lock to report who holds it) and one in `releaseLock` (reading the lock to verify owner before releasing).

**Files:**
- Modify: `src/locks.js`

- [ ] **Step 1: Fix `src/locks.js`**

Add import at top of file (after existing requires):
```js
const { safeReadJson } = require("./safety");
```

In `acquireLock`, replace the bare parse (line 24) inside the `if (fs.existsSync(file) && args.steal !== true)` block:

Old:
```js
  if (fs.existsSync(file) && args.steal !== true) {
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    throw new Error(`Lock already held by ${existing.owner || existing.id}: ${workspace}/${resource}`);
  }
```

New:
```js
  if (fs.existsSync(file) && args.steal !== true) {
    const existing = safeReadJson(file);
    throw new Error(`Lock already held by ${existing ? (existing.owner || existing.id) : "unknown"}: ${workspace}/${resource}`);
  }
```

In `releaseLock`, replace the bare parse (line 45):

Old:
```js
  const lock = JSON.parse(fs.readFileSync(file, "utf8"));
```

New:
```js
  const lock = safeReadJson(file);
  if (!lock) throw new Error(`Lock file corrupted: ${workspace}/${resource}`);
```

- [ ] **Step 2: Smoke test**

Run: `node test/smoke.mjs`

Expected: exits 0 with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/locks.js
git commit -m "fix: wrap JSON.parse in safeReadJson for lock acquire and release"
```

---

## Task 5: Fix `src/memory.js` and `src/scheduler.js`

These are registry-style reads where returning an empty fallback is safe.

**Files:**
- Modify: `src/memory.js`, `src/scheduler.js`

- [ ] **Step 1: Fix `src/memory.js`**

Add import at top of file (after existing requires):
```js
const { safeReadJson } = require("./safety");
```

Replace `readMemory` function (lines 8–12):
```js
function readMemory(config, workspace) {
  const file = workspaceMemoryPath(config, workspace);
  if (!fs.existsSync(file)) return { workspace: workspace.alias || workspace, notes: [], updatedAt: null };
  return safeReadJson(file, { workspace: workspace.alias || workspace, notes: [], updatedAt: null });
}
```

- [ ] **Step 2: Fix `src/scheduler.js`**

Add import at top of file (after existing requires):
```js
const { safeReadJson } = require("./safety");
```

Replace line 64 in `readScheduler` — the bare parse inside the return:

Old:
```js
  return { ok: true, scheduler: JSON.parse(fs.readFileSync(file, "utf8")) };
```

New:
```js
  const scheduler = safeReadJson(file);
  if (!scheduler) return { ok: false, schedulerId: id, message: "Scheduler record corrupted." };
  return { ok: true, scheduler };
```

Replace line 69 in `updateScheduler` — the ternary with bare parse:

Old:
```js
  const current = fs.existsSync(schedulerPath(config, id)) ? JSON.parse(fs.readFileSync(schedulerPath(config, id), "utf8")) : { id, createdAt: new Date().toISOString() };
```

New:
```js
  const current = fs.existsSync(schedulerPath(config, id))
    ? (safeReadJson(schedulerPath(config, id)) ?? { id, createdAt: new Date().toISOString() })
    : { id, createdAt: new Date().toISOString() };
```

- [ ] **Step 3: Smoke test**

Run: `node test/smoke.mjs`

Expected: exits 0 with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/memory.js src/scheduler.js
git commit -m "fix: wrap JSON.parse in safeReadJson for memory and scheduler"
```

---

## Task 6: Fix `src/indexer.js` and `src/semantic.js`

Both have callers that assume a non-null return (they use `.files` and `.documents` respectively), so return a corrupt-specific error rather than a silent fallback.

**Files:**
- Modify: `src/indexer.js`, `src/semantic.js`

- [ ] **Step 1: Fix `src/indexer.js`**

`src/indexer.js` already imports `collectTextFiles, readTextFileSafe, fileSha256` from `./safety`. Update that destructure:
```js
const { collectTextFiles, readTextFileSafe, fileSha256, safeReadJson } = require("./safety");
```

Replace `readIndex` function (lines 82–87):
```js
function readIndex(config, workspace, args = {}) {
  const sessionId = args.sessionId || workspace.taskSessionId || null;
  const file = indexPath(config, workspace, sessionId);
  if (!fs.existsSync(file)) throw new Error("Repository index does not exist. Run relai_index_build first.");
  const data = safeReadJson(file);
  if (!data) throw new Error("Repository index file corrupted. Re-run relai_index_build.");
  return data;
}
```

- [ ] **Step 2: Fix `src/semantic.js`**

`src/semantic.js` already imports `collectTextFiles, readTextFileSafe` from `./safety`. Update that destructure:
```js
const { collectTextFiles, readTextFileSafe, safeReadJson } = require("./safety");
```

Replace `readIndex` function (lines 37–41):
```js
function readIndex(config, workspace) {
  const file = indexPath(config, workspace);
  if (!fs.existsSync(file)) throw new Error(`Semantic index not found for ${workspace.alias}. Run relai_semantic_index_build first.`);
  const data = safeReadJson(file);
  if (!data) throw new Error(`Semantic index file corrupted for ${workspace.alias}. Re-run relai_semantic_index_build.`);
  return data;
}
```

- [ ] **Step 3: Smoke test**

Run: `node test/smoke.mjs`

Expected: exits 0 with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/indexer.js src/semantic.js
git commit -m "fix: wrap JSON.parse in safeReadJson for indexer and semantic index"
```

---

## Task 7: Fix `src/config.js`

Config is the most critical file — a corrupted config crashes on every startup. Replace the separate `readFileSync` + `JSON.parse` with `safeReadJson` and throw a clear, actionable error.

**Files:**
- Modify: `src/config.js`

- [ ] **Step 1: Fix `src/config.js`**

Add import at top of file (after `const path = require("node:path");`):
```js
const { safeReadJson } = require("./safety");
```

Replace lines 113–115 in `readConfig`:

Old:
```js
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw);
  return normalizeConfig(parsed);
```

New:
```js
  const parsed = safeReadJson(configPath);
  if (!parsed) throw new Error(`Config file is corrupted or empty: ${configPath}. Fix or re-run: npm run init-config`);
  return normalizeConfig(parsed);
```

- [ ] **Step 2: Smoke test**

Run: `node test/smoke.mjs`

Expected: exits 0 with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/config.js
git commit -m "fix: wrap JSON.parse in safeReadJson for config read"
```

---

## Task 8: Fix `src/productUx.js`

Two bare parses: one in `importOriginalRelAiConfig` (user-supplied source file) and one in `stateImport` (user-supplied input file). Both should fail fast with a clear message on corruption.

**Files:**
- Modify: `src/productUx.js`

- [ ] **Step 1: Fix `src/productUx.js`**

Add import near the top (after existing requires, e.g. after the `runProcess` import line):
```js
const { safeReadJson } = require("./safety");
```

In `importOriginalRelAiConfig` (around line 204), replace the bare parse:

Old:
```js
  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
```

New:
```js
  const source = safeReadJson(sourcePath);
  if (!source) throw new Error(`Original Rel.AI config file is corrupted or empty: ${sourcePath}`);
```

In `stateImport` (around line 238), replace the bare parse:

Old:
```js
  if (args.inputPath) payload = JSON.parse(fs.readFileSync(path.resolve(String(args.inputPath)), "utf8"));
```

New:
```js
  if (args.inputPath) {
    payload = safeReadJson(path.resolve(String(args.inputPath)));
    if (!payload) throw new Error(`State import file is corrupted or empty: ${args.inputPath}`);
  }
```

- [ ] **Step 2: Smoke test**

Run: `node test/smoke.mjs`

Expected: exits 0 with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/productUx.js
git commit -m "fix: wrap JSON.parse in safeReadJson for productUx import/stateImport"
```

---

## Task 9: Fix hardcoded test token and `spawnSync` shell flag

**Files:**
- Modify: `test/http-smoke.mjs`, `src/release.js`

- [ ] **Step 1: Fix hardcoded test token in `test/http-smoke.mjs`**

Replace line 9:

Old:
```js
const token = 'test-token-please-change';
```

New:
```js
const token = process.env.TEST_TOKEN ?? 'test-token-please-change';
```

- [ ] **Step 2: Fix `spawnSync` shell flag in `src/release.js`**

In `commandExists` (line 261), `command -v` is a shell builtin so it requires `shell: true` on Unix. Replace with `which` (an executable) to allow `shell: false` everywhere:

Old:
```js
function commandExists(command) {
  const isWindows = process.platform === "win32";
  const lookup = isWindows ? "where" : "command";
  const args = isWindows ? [command] : ["-v", command];
  try {
    const child = require("node:child_process").spawnSync(lookup, args, { shell: !isWindows, encoding: "utf8" });
    return { command, ok: child.status === 0, path: (child.stdout || "").trim().split(/\r?\n/)[0] || "" };
  } catch (error) {
    return { command, ok: false, error: error.message };
  }
}
```

New:
```js
function commandExists(command) {
  const isWindows = process.platform === "win32";
  const lookup = isWindows ? "where" : "which";
  const args = [command];
  try {
    const child = require("node:child_process").spawnSync(lookup, args, { shell: false, encoding: "utf8" });
    return { command, ok: child.status === 0, path: (child.stdout || "").trim().split(/\r?\n/)[0] || "" };
  } catch (error) {
    return { command, ok: false, error: error.message };
  }
}
```

- [ ] **Step 3: Run HTTP smoke test**

Run: `node test/http-smoke.mjs`

Expected: `HTTP smoke test passed. Tools: <N>`

- [ ] **Step 4: Commit**

```bash
git add test/http-smoke.mjs src/release.js
git commit -m "fix: use env var for test token and replace shell=true spawnSync with which"
```

---

## Summary

After all 9 tasks complete:
- 16 call sites across 14 files protected from corrupt JSON crashes
- All single-item reads throw descriptive errors on corruption (not silent null)
- Registry reads return safe empty fallbacks on corruption
- Test token reads from `TEST_TOKEN` env var with safe hardcoded fallback
- `commandExists` uses `which`/`where` with `shell: false` on all platforms
