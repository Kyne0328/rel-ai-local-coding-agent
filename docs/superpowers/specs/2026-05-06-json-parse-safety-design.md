# JSON Parse Safety & Bug Fixes Design

**Date:** 2026-05-06
**Scope:** Defensive error handling for JSON persistence layer + minor bug fixes

---

## Problem

14 files (16 call sites) call `JSON.parse(fs.readFileSync(file))` without try-catch. A corrupted or partially-written file crashes the entire process. This affects all persistence paths: jobs, sessions, plans, approvals, locks, memory, multiagent subtasks, scheduler state, semantic index, snapshots, productUx import/export.

Two additional lower-priority bugs: hardcoded test token and `spawnSync` with `shell: true` on non-Windows.

---

## Design

### 1. `safeReadJson(file, fallback)` utility in `src/safety.js`

```js
function safeReadJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`[rel-ai-mcp] Failed to read JSON at ${file}: ${err.message}`);
    return fallback;
  }
}
```

- `fallback = null` for single-item reads (job, session, plan, approval, lock, subtask, snapshot)
- `fallback = {}` for registry/index reads (memory, scheduler state, semantic index, indexer)
- `fallback = []` only if caller expects array (none identified currently)
- Exported alongside existing `safety.js` exports

### 2. Call-site replacements (12 files)

Each file imports `safeReadJson` from `./safety.js` (or relative path). Replace pattern:

```js
// Before
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// After
const data = safeReadJson(file);   // or safeReadJson(file, {})
```

Files and appropriate fallback:

| File | Function | Fallback |
|------|----------|---------|
| `src/approvals.js:58` | `readApproval()` | `null` |
| `src/config.js:114` | `readConfig()` | `null` |
| `src/indexer.js:86` | `readIndex()` | `{}` |
| `src/jobs.js:31` | `readJob()` | `null` |
| `src/locks.js:24` | `acquireLock()` | `null` |
| `src/locks.js:45` | `releaseLock()` | `null` |
| `src/memory.js:11` | `readMemory()` | `{}` |
| `src/multiagent.js:45` | `readSubtask()` | `null` |
| `src/plans.js:72` | `readPlan()` | `null` |
| `src/scheduler.js:64` | `readScheduler()` | `{}` |
| `src/scheduler.js:69` | status update | `{}` |
| `src/semantic.js:40` | `readIndex()` | `{}` |
| `src/sessions.js:46` | `readSession()` | `null` |
| `src/snapshots.js:58` | `readSnapshot()` | `null` |
| `src/productUx.js:204` | import | `null` |
| `src/productUx.js:238` | export | `null` |

### 3. Test token fix — `test/http-smoke.mjs:9`

```js
// Before
const token = 'test-token-please-change';

// After
const token = process.env.TEST_TOKEN ?? 'test-token-please-change';
```

### 4. `spawnSync` shell flag — `src/release.js:261`

Change `shell: true` on non-Windows to `shell: false`. Inputs are already constrained to `['git', 'node', 'gh', 'docker']` but consistent `shell: false` removes the surface area entirely.

---

## Error Handling

- `safeReadJson` swallows parse/read errors and logs `console.warn` with file path and error message
- Callers that receive `null` already handle "not found" paths (existing `if (!item) return` patterns)
- Callers that receive `{}` treat it as empty state and proceed normally
- No silent data loss: the warn log surfaces corruption for diagnosis

---

## Testing

- Unit test `safeReadJson` with: valid JSON, malformed JSON, missing file, empty file
- Existing integration tests should pass unchanged (no behavior change on happy path)
- Smoke test: corrupt a job file manually, verify server stays up and logs warning

---

## Out of Scope

- Atomic writes (write-to-temp + rename) — separate improvement, not part of this fix
- JSON schema validation — separate improvement
- Audit/retry on corruption — out of scope for now
