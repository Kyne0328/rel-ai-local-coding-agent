const fs = require("node:fs");
const path = require("node:path");
const {
  collectTextFiles,
  collectOptionsFromWorkspace,
  writeTextFileSafe,
  resolveSafePath,
  fileSha256,
  looksBinary
} = require("./safety");
const { discoverCommands } = require("./commandDiscovery");
const { getStateDir } = require("./audit");
const { appendOperation, makeOperationId, summarizeOperations } = require("./journal");
const { resolvePolicy } = require("./policyResolver");
const { resolveBudget } = require("./budgetResolver");
const sessionCache = require("./sessionCache");
const {
  relaiGitStatus,
  relaiGitCommit,
  relaiGitPush,
  relaiGitCreatePr,
  classifyStatusOwnership
} = require("./repo/gitOps");
const { clampNumber } = require("./bridge/limits");
const { relaiVerify } = require("./bridge/validation");
const { relaiBrowser } = require("./bridge/browser");
const { relaiDiff, relaiReset } = require("./bridge/review");
const { workspaceTidyPlan, workspaceTidyRun: relaiWorkspaceTidyRun } = require("./bridge/tidy");
const { relaiApplyPatch, normalizeOpenAIPatchFormat } = require("./bridge/patch");

const DEFAULT_MAX_READ_BYTES = 1024 * 1024;
const DEFAULT_MAX_SNAPSHOT_FILES = 1000;
const DEFAULT_STAGED_CHUNK_BYTES = 12000;
const STAGED_WRITE_BYTE_THRESHOLD = 8000;
const STAGED_WRITE_LINE_THRESHOLD = 180;
const EXACT_REPLACE_TEXT_BYTE_LIMIT = 50000;
const EXACT_REPLACE_MAX_OPERATIONS = 50;
const SOURCE_LIKE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.dart', '.py', '.go', '.rs', '.java', '.kt', '.swift', '.cs', '.cpp', '.c', '.h', '.hpp', '.rb', '.php', '.css', '.scss', '.html', '.xml', '.yaml', '.yml', '.json', '.md']);

function repoSnapshot(workspace, config, args = {}) {
  const policy = resolvePolicy(workspace, config || {});
  const effectiveDefault = resolveBudget(DEFAULT_MAX_SNAPSHOT_FILES, policy, config || {});
  const maxEntries = clampNumber(args.maxEntries, 1, 20000, effectiveDefault);
  const includeFiles = args.includeFiles !== false;
  const tree = collectTextFiles(workspace.path, collectOptionsFromWorkspace(workspace, { maxEntries }));
  const manifests = readManifests(workspace.path);
  const discoveredCommands = discoverCommands(workspace.path);
  return {
    ok: true,
    workspace: workspace.alias,
    root: workspace.path,
    toolMode: config.toolMode || "chatgpt_local_repo",
    trustedLocalAgent: Boolean(config.trustedLocalAgent),
    manifests: Object.keys(manifests),
    manifestContents: manifests,
    discoveredCommands,
    fileCount: tree.files.length,
    effectiveMaxEntries: maxEntries,
    budgetMultiplied: effectiveDefault !== DEFAULT_MAX_SNAPSHOT_FILES,
    ...(includeFiles ? { files: tree.files } : {}),
    skipped: tree.skipped.slice(0, 200),
    truncated: tree.truncated,
    hints: projectHints(Object.keys(manifests)),
    recommendedFlow: ["relai_repo_snapshot", "relai_read", "relai_edit", "relai_write", "relai_replace", "relai_tidy_plan", "relai_tidy_run", "relai_run_checks", "relai_diff", "relai_restore_changes"],
    writeGuidance: workspaceWriteGuidance(config),
    operationJournal: summarizeOperations(config, workspace, args.journalLimit || 10)
  };
}

function relaiRead(workspace, config, args = {}) {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (paths.length === 0) throw new Error("paths must contain at least one path.");
  const policy = resolvePolicy(workspace, config || {});
  const sessionActive = policy?.sessionActive === true;
  const defaultMaxBytes = resolveBudget(DEFAULT_MAX_READ_BYTES, policy, config || {});
  const maxBytes = clampNumber(args.maxBytes, 1000, 10 * 1024 * 1024, defaultMaxBytes);
  const items = [];
  const skipped = [];
  for (const requested of paths) {
    const result = readSingleItem(workspace, config, requested, sessionActive, maxBytes, args);
    if (result.item) items.push(result.item);
    if (result.skipped) skipped.push(result.skipped);
  }
  return { ok: true, workspace: workspace.alias, items, skipped };
}

function readSingleItem(workspace, config, requested, sessionActive, maxBytes, args) {
  try {
    const safe = resolveSafePath(workspace.path, requested);
    const stat = fs.statSync(safe.absolutePath);
    if (!stat.isFile()) {
      return stat.isDirectory()
        ? { item: readDirectory(workspace, safe.relativePath, args) }
        : { skipped: { path: String(requested), reason: "not a file or directory" } };
    }
    const { data, text, cacheHit } = readTextContent(workspace, safe, stat, sessionActive);
    if (data === null) {
      return { skipped: { path: safe.relativePath, reason: "binary-looking file" } };
    }
    const byteLen = Buffer.byteLength(text, "utf8");
    const truncated = byteLen > maxBytes;
    const item = {
      type: "file", path: safe.relativePath,
      sha256: fileSha256(workspace.path, safe.relativePath),
      bytes: data ? data.length : byteLen,
      lineCount: countLines(text), truncated,
      writeGuidance: fileWriteGuidance(safe.relativePath, text),
      content: truncated ? text.slice(0, maxBytes) : text,
      ...(sessionActive ? { cacheHit } : {})
    };
    return { item };
  } catch (error) {
    return { skipped: { path: String(requested), reason: error instanceof Error ? error.message : String(error) } };
  }
}

function readTextContent(workspace, safe, stat, sessionActive) {
  if (sessionActive) {
    const cached = sessionCache.getCachedRead(workspace.alias, safe.absolutePath, stat.mtimeMs);
    if (cached !== null) return { data: null, text: cached, cacheHit: true };
  }
  const data = fs.readFileSync(safe.absolutePath);
  if (looksBinary(data)) return { data: null, text: "", cacheHit: false };
  const text = data.toString("utf8");
  if (sessionActive) {
    sessionCache.setCachedRead(workspace.alias, safe.absolutePath, stat.mtimeMs, text);
  }
  return { data, text, cacheHit: false };
}

const WRITE_STAGE_HANDLERS = {
  direct: handleWriteDirect,
  "": handleWriteDirect,
  start: handleWriteStart,
  append: handleWriteAppend,
  commit: handleWriteCommit,
  abort: handleWriteAbort
};

function relaiWrite(workspace, config, args = {}) {
  const stage = String(args.stage || "direct").trim().toLowerCase();
  const handler = WRITE_STAGE_HANDLERS[stage];
  if (!handler) throw new Error("relai_write stage must be one of: direct, start, append, commit, abort.");
  return handler(workspace, config, args);
}

function handleWriteDirect(workspace, config, args) {
  const relativePath = String(args.path || "").trim();
  if (!relativePath) throw new Error("relai_write requires path and content. Expected: { workspace, path, content }.");
  if (typeof args.content !== "string") throw new Error("relai_write requires content as a string containing the entire target file. Expected: { workspace, path, content }.");
  assertDirectWriteAllowed(relativePath, args.content);
  return performFullFileWrite(workspace, config, relativePath, args.content, { dryRun: Boolean(args.dryRun) });
}

function handleWriteStart(workspace, config, args) {
  const relativePath = String(args.path || "").trim();
  if (!relativePath) throw new Error("relai_write stage='start' requires path and content.");
  if (typeof args.content !== "string") throw new Error("relai_write stage='start' requires a content chunk string.");
  const safe = resolveSafePath(workspace.path, relativePath);
  const writeId = makeOperationId();
  writeStagedPayload(config, workspace, writeId, {
    id: writeId, workspace: workspace.alias, root: workspace.path,
    path: safe.relativePath, chunks: [args.content],
    bytes: Buffer.byteLength(args.content, "utf8"),
    createdAt: new Date().toISOString()
  });
  return {
    ok: true, workspace: workspace.alias, path: safe.relativePath,
    operation: "stagedFullFileWrite:start", writeId, chunks: 1,
    bytes: Buffer.byteLength(args.content, "utf8"),
    next: "Call relai_write with { workspace, stage: 'append', writeId, content } for more chunks, then { workspace, stage: 'commit', writeId } to write the complete file."
  };
}

function handleWriteAppend(workspace, config, args) {
  if (typeof args.content !== "string") throw new Error("relai_write stage='append' requires writeId and a content chunk string.");
  const writeId = resolveStagedWriteId(config, workspace, args.writeId, args.path);
  const payload = readStagedPayload(config, workspace, writeId);
  payload.chunks.push(args.content);
  payload.bytes += Buffer.byteLength(args.content, "utf8");
  payload.updatedAt = new Date().toISOString();
  writeStagedPayload(config, workspace, writeId, payload);
  return {
    ok: true, workspace: workspace.alias, path: payload.path,
    operation: "stagedFullFileWrite:append", writeId,
    chunks: payload.chunks.length, bytes: payload.bytes,
    next: "Append more chunks or call relai_write with { workspace, stage: 'commit', writeId }."
  };
}

function handleWriteCommit(workspace, config, args) {
  const writeId = resolveStagedWriteId(config, workspace, args.writeId, args.path);
  const payload = readStagedPayload(config, workspace, writeId);
  const content = payload.chunks.join("");
  const result = performFullFileWrite(workspace, config, payload.path, content, { dryRun: Boolean(args.dryRun), staged: true, writeId });
  if (!args.dryRun) clearStagedPayload(config, workspace, writeId);
  return { ...result, operation: "stagedFullFileWrite:commit", writeId, staged: true, chunks: payload.chunks.length, bytes: Buffer.byteLength(content, "utf8") };
}

function handleWriteAbort(workspace, config, args) {
  const writeId = validateWriteId(args.writeId);
  const existed = clearStagedPayload(config, workspace, writeId);
  return { ok: true, workspace: workspace.alias, operation: "stagedFullFileWrite:abort", writeId, cleared: existed };
}

function applyReplacements(replacements, oldContent, relativePath) {
  let nextContent = oldContent;
  const results = [];
  for (let index = 0; index < replacements.length; index += 1) {
    const item = replacements[index];
    const before = nextContent;
    const totalMatches = countStringOccurrences(before, item.oldText);
    if (totalMatches === 0) {
      throw new Error(`relai_replace operation ${index + 1} found 0 matches in ${relativePath}. Re-read the file and use exact current text.`);
    }
    const hasExplicitOccurrence = item.occurrence != null;
    if (!hasExplicitOccurrence && totalMatches !== 1) {
      throw new Error(`relai_replace operation ${index + 1} found ${totalMatches} matches in ${relativePath}. Pass occurrence to replace exactly one match, or use a larger unique oldText block.`);
    }
    const occurrence = hasExplicitOccurrence ? item.occurrence : 1;
    if (occurrence > totalMatches) {
      throw new Error(`relai_replace operation ${index + 1} requested occurrence ${occurrence}, but only ${totalMatches} matches exist in ${relativePath}.`);
    }
    nextContent = replaceNth(before, item.oldText, item.newText, occurrence);
    results.push({ index: index + 1, matchesBefore: totalMatches, occurrence, oldBytes: Buffer.byteLength(item.oldText, "utf8"), newBytes: Buffer.byteLength(item.newText, "utf8"), changed: nextContent !== before });
  }
  return { nextContent, results };
}

function relaiReplace(workspace, config, args = {}) {
  const safe = resolveSafePath(workspace.path, String(args.path || "").trim());
  if (!safe.relativePath) throw new Error("relai_replace requires path.");
  const dryRun = Boolean(args.dryRun);
  if (!fs.existsSync(safe.absolutePath)) throw new Error(`relai_replace target does not exist: ${safe.relativePath}`);
  const stat = fs.statSync(safe.absolutePath);
  if (!stat.isFile()) throw new Error(`relai_replace target is not a file: ${safe.relativePath}`);
  const data = fs.readFileSync(safe.absolutePath);
  if (looksBinary(data)) throw new Error(`relai_replace refuses binary-looking files: ${safe.relativePath}`);

  const oldSha256 = fileSha256(workspace.path, safe.relativePath);
  const expectedSha256 = String(args.expectedSha256 || "").trim();
  if (expectedSha256 && oldSha256 !== expectedSha256) {
    throw new Error(`relai_replace refused stale expectedSha256 for ${safe.relativePath}. Expected ${expectedSha256}, current ${oldSha256 || "missing"}. Re-read the file and retry with current content.`);
  }
  const shaMismatch = false;

  const replacements = normalizeExactReplacements(args);
  const oldContent = data.toString("utf8");
  const { nextContent, results } = applyReplacements(replacements, oldContent, safe.relativePath);

  const changed = nextContent !== oldContent;
  const newSha256 = changed ? sha256Text(nextContent) : oldSha256;
  const operationId = makeOperationId();
  const result = {
    ok: true,
    dryRun,
    workspace: workspace.alias,
    operationId,
    operation: "exactReplace",
    path: safe.relativePath,
    changed,
    changedFiles: changed ? [safe.relativePath] : [],
    oldSha256,
    newSha256,
    ...(shaMismatch ? { shaMismatch: { expectedSha256, currentSha256: oldSha256 } } : {}),
    replacements: results
  };

  if (changed && !dryRun) {
    const write = writeTextFileSafe(workspace.path, safe.relativePath, nextContent);
    const verifiedSha256 = fileSha256(workspace.path, safe.relativePath);
    if (verifiedSha256 !== write.sha256 || verifiedSha256 !== newSha256) {
      throw new Error(`Fresh read verification failed for ${safe.relativePath}. Expected ${newSha256}, got ${verifiedSha256 || "missing"}.`);
    }
    result.verified = true;
    result.bytes = write.bytes;
  }

  appendOperation(config, workspace, {
    id: operationId,
    type: dryRun ? "replace:dryRun" : "replace",
    ok: true,
    paths: result.changedFiles,
    results: [{ path: safe.relativePath, operation: "exactReplace", changed, oldSha256, newSha256, verified: dryRun || !changed || result.verified === true }]
  });

  return result;
}

function assertDirectWriteAllowed(relativePath, content) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  if (/(^|\/)(dist|build|coverage|node_modules)\//.test(normalized) || /\.min\.[^.]+$/i.test(normalized)) return;
  const ext = path.extname(normalized).toLowerCase();
  const collapseGuardExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.dart', '.py', '.go', '.rs', '.java', '.kt', '.swift', '.cs', '.cpp', '.c', '.h', '.hpp', '.rb', '.php', '.css', '.scss', '.html', '.xml', '.yaml', '.yml']);
  if (!collapseGuardExtensions.has(ext)) return;
  const text = String(content || "");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes < 4000) return;
  const newlines = countMatches(text, /\n/g);
  const averageLineBytes = bytes / Math.max(1, newlines + 1);
  if (newlines <= 2 && averageLineBytes > 2000) {
    throw new Error(`relai_write refuses collapsed source-looking content for ${relativePath}. Use relai_edit with oldText/newText, relai_edit with updateText, or staged relai_write with the original line breaks intact.`);
  }
}

function performFullFileWrite(workspace, config, relativePath, content, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const operationId = options.writeId || makeOperationId();
  const safe = resolveSafePath(workspace.path, relativePath);
  const exists = fs.existsSync(safe.absolutePath);
  const oldContent = exists ? fs.readFileSync(safe.absolutePath, "utf8") : "";
  const oldSha256 = exists ? fileSha256(workspace.path, safe.relativePath) : null;
  const newContent = content;
  const changed = newContent !== oldContent;
  const newSha256 = sha256Text(newContent);

  const result = {
    ok: true,
    path: safe.relativePath,
    operation: options.staged ? "stagedFullFileWrite" : "fullFileWrite",
    changed,
    oldSha256,
    newSha256: changed ? newSha256 : oldSha256,
    ...(dryRun ? { dryRun: true } : {})
  };

  if (changed && !dryRun) {
    const write = writeTextFileSafe(workspace.path, safe.relativePath, newContent);
    const verifiedSha256 = fileSha256(workspace.path, safe.relativePath);
    if (verifiedSha256 !== write.sha256) {
      throw new Error(`Fresh read verification failed for ${safe.relativePath}. Expected ${write.sha256}, got ${verifiedSha256 || "missing"}.`);
    }
    result.newSha256 = write.sha256;
    result.verified = write.verified === true;
    result.bytes = write.bytes;
  }

  const summary = {
    ok: true,
    dryRun,
    workspace: workspace.alias,
    operationId,
    changedFiles: changed ? [safe.relativePath] : [],
    result
  };

  appendOperation(config, workspace, {
    id: operationId,
    type: dryRun ? "write:dryRun" : "write",
    ok: true,
    paths: summary.changedFiles,
    results: [{
      path: safe.relativePath,
      operation: result.operation,
      changed,
      oldSha256,
      newSha256: result.newSha256,
      verified: dryRun || result.verified === true || !changed
    }]
  });

  return summary;
}

function stagedDir(config, workspace) {
  const safeAlias = String(workspace.alias || "workspace").replace(/[^A-Za-z0-9_.-]/g, "_");
  return path.join(getStateDir(config), "write-staging", safeAlias);
}

function stagedPath(config, workspace, writeId) {
  return path.join(stagedDir(config, workspace), `${validateWriteId(writeId)}.json`);
}

function validateWriteId(writeId) {
  const text = String(writeId || "").trim();
  if (!/^op_[a-z0-9]+_[a-f0-9]{12}$/.test(text)) throw new Error("Invalid or missing relai_write writeId.");
  return text;
}

// Fallback only applies to staged writes touched within this window. Prevents an
// abandoned staged payload from a much earlier session being resurrected and
// committed (which could overwrite an unrelated tracked file).
const STAGED_FALLBACK_TTL_MS = 6 * 60 * 60 * 1000;
// Staged payloads older than this are pruned on any staged-write access.
const STAGED_PRUNE_TTL_MS = 24 * 60 * 60 * 1000;

// Resolve the writeId for a staged append/commit. ChatGPT must otherwise echo a
// long opaque writeId across three separate tool calls; a single dropped or
// mistyped id breaks the operation with "No staged payload found".
//
// Resolution order — each step is safe and NEVER guesses among ambiguous
// candidates (guessing the most-recent payload previously committed the wrong,
// stale file and could clobber an unrelated tracked file):
//   1. Exact writeId match against an existing staged file (no TTL).
//   2. If a path is supplied, the unique fresh staged write for that path.
//   3. Exactly one fresh staged write total (the normal single in-flight case).
//   4. Otherwise refuse and list the candidates so the caller passes id/path.
function resolveStagedWriteId(config, workspace, rawWriteId, targetPath) {
  const text = String(rawWriteId || "").trim();
  if (text && /^op_[a-z0-9]+_[a-f0-9]{12}$/.test(text) && fs.existsSync(stagedPath(config, workspace, text))) {
    return text;
  }
  const fresh = listStagedPayloads(config, workspace)
    .filter((item) => item.ageMs == null || item.ageMs <= STAGED_FALLBACK_TTL_MS);

  const wantPath = stagedRelativePath(workspace, targetPath);
  if (wantPath) {
    const byPath = fresh.filter((item) => item.path === wantPath);
    if (byPath.length === 1) return byPath[0].id;
    if (byPath.length > 1) throw stagedAmbiguityError(byPath, text);
  }

  if (fresh.length === 1) return fresh[0].id;
  throw stagedAmbiguityError(fresh, text);
}

function stagedRelativePath(workspace, targetPath) {
  const raw = String(targetPath || "").trim();
  if (!raw) return null;
  try {
    return resolveSafePath(workspace.path, raw).relativePath;
  } catch {
    return null;
  }
}

function stagedAmbiguityError(candidates, suppliedId) {
  if (!candidates.length) {
    const idSuffix = suppliedId ? ` for writeId ${suppliedId}` : "";
    return new Error(`No staged relai_write payload found${idSuffix}. Start a staged write with stage='start' first, or use a direct write { stage: 'direct', path, content } (direct write has no size cap).`);
  }
  const list = candidates.map((item) => `${item.id} → ${item.path || "(unknown path)"}`).join("; ");
  return new Error(`Multiple staged relai_write payloads are pending; refusing to guess which to use. Pass the exact writeId, or the target path, for the one you mean. Pending: ${list}.`);
}

function listStagedPayloads(config, workspace) {
  const dir = stagedDir(config, workspace);
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const now = Date.now();
  const out = [];
  for (const name of names) {
    const item = readStagedFile(dir, name, now);
    if (item) out.push(item);
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function readStagedFile(dir, name, now) {
  if (!name.endsWith(".json")) return null;
  const id = name.slice(0, -5);
  if (!/^op_[a-z0-9]+_[a-f0-9]{12}$/.test(id)) return null;
  const file = path.join(dir, name);
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return null; }
  if (mtime && (now - mtime) > STAGED_PRUNE_TTL_MS) {
    try { fs.rmSync(file, { force: true }); } catch {}
    return null;
  }
  let payload;
  try { payload = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  return { id, path: payload.path || null, mtime, ageMs: mtime ? now - mtime : null };
}

function writeStagedPayload(config, workspace, writeId, payload) {
  const file = stagedPath(config, workspace, writeId);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
}

function readStagedPayload(config, workspace, writeId) {
  const file = stagedPath(config, workspace, writeId);
  if (!fs.existsSync(file)) throw new Error(`No staged relai_write payload found for writeId ${writeId}. Start again with stage='start'.`);
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  if (payload.workspace !== workspace.alias || payload.root !== workspace.path) throw new Error("Staged relai_write payload belongs to a different workspace.");
  return payload;
}

function clearStagedPayload(config, workspace, writeId) {
  const file = stagedPath(config, workspace, writeId);
  const existed = fs.existsSync(file);
  if (existed) fs.rmSync(file, { force: true });
  return existed;
}

function readDirectory(workspace, relativePath, args) {
  const maxEntries = clampNumber(args.maxEntries, 1, 20000, 1000);
  const prefix = relativePath === "." ? "" : relativePath;
  const result = collectTextFiles(path.join(workspace.path, prefix), collectOptionsFromWorkspace(workspace, { maxEntries, includeRoots: [] }));
  return {
    type: "directory",
    path: relativePath,
    fileCount: result.files.length,
    files: result.files.map((item) => prefix ? `${prefix}/${item}` : item),
    skipped: result.skipped,
    truncated: result.truncated
  };
}

function readManifests(root) {
  const names = ["package.json", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "pubspec.yaml", "Makefile"];
  const out = {};
  for (const name of names) {
    const abs = path.join(root, name);
    if (!fs.existsSync(abs)) continue;
    try {
      const text = fs.readFileSync(abs, "utf8");
      out[name] = text.slice(0, 20000);
    } catch {}
  }
  return out;
}

function projectHints(manifests) {
  const hints = [];
  if (manifests.includes("package.json")) hints.push("Node/JavaScript/TypeScript project");
  if (manifests.includes("pyproject.toml") || manifests.includes("requirements.txt")) hints.push("Python project");
  if (manifests.includes("Cargo.toml")) hints.push("Rust project");
  if (manifests.includes("go.mod")) hints.push("Go project");
  if (manifests.includes("pubspec.yaml")) hints.push("Flutter/Dart project");
  return hints;
}

function workspaceWriteGuidance(config) {
  return {
    defaultMode: "size-based",
    recommendedChunkBytes: DEFAULT_STAGED_CHUNK_BYTES,
    modes: {
      "exact-replace": {
        tool: "relai_replace",
        when: [
          "localized edits inside existing files",
          "large source files",
          "template-heavy or interpolation-heavy files",
          "duplicate import cleanup, lint-only text edits, and focused behavior changes"
        ]
      },
      "direct-write": {
        tool: "relai_write",
        when: [
          "complete replacement of a small or normal-sized file",
          `whole-file content under about ${STAGED_WRITE_BYTE_THRESHOLD} bytes and ${STAGED_WRITE_LINE_THRESHOLD} lines`
        ]
      },
      "staged-write": {
        tool: "relai_write",
        when: [
          "complete replacement of a large file",
          `whole-file content above about ${STAGED_WRITE_BYTE_THRESHOLD} bytes or ${STAGED_WRITE_LINE_THRESHOLD} lines`
        ],
        chunkBytes: DEFAULT_STAGED_CHUNK_BYTES
      },
      "apply-update": {
        tool: "relai_edit",
        when: [
          "a multi-file change is already represented as a unified patch (pass updateText)",
          "several related files need coordinated text edits (pass edits: [...])"
        ]
      },
      "workspace-tidy": {
        tools: ["relai_tidy_plan", "relai_tidy_run"],
        when: ["generated session artifacts should be tidied through a bounded plan"]
      }
    },
    selectionOrder: [
      "Use exact-replace for small edits inside existing files.",
      "Use direct-write for complete replacement of small or normal-sized files.",
      "Use staged-write for complete replacement of large files.",
      "Use apply-update when the change is naturally patch-shaped across files.",
      "Use workspace-tidy plan/run for generated session artifacts."
    ],
    examples: {
      exactReplace: "relai_replace { workspace, path, expectedSha256, oldText, newText }",
      directWrite: "relai_write { workspace, path, content }",
      stagedWriteStart: "relai_write { workspace, stage: 'start', path, content }",
      stagedWriteAppend: "relai_write { workspace, stage: 'append', writeId, content }",
      stagedWriteCommit: "relai_write { workspace, stage: 'commit', writeId }",
      applyUpdate: "relai_edit { workspace, updateText, runChecks: true, returnDiff: true }",
      workspaceTidyPlan: "relai_tidy_plan { workspace, mode: 'session_untracked' }",
      workspaceTidyRun: "relai_tidy_run { workspace, planId }"
    },
    next: "Choose the edit tool by task shape and file size, then run relai_run_checks and relai_diff."
  };
}

function fileWriteGuidance(relativePath, text) {
  const bytes = Buffer.byteLength(text, "utf8");
  const lineCount = countLines(text);
  const ext = path.extname(relativePath).toLowerCase();
  const isSourceLike = SOURCE_LIKE_EXTENSIONS.has(ext);
  const interpolationMarkers = countMatches(text, /\$\{|\{\{/g);
  const reasons = [];

  if (bytes >= STAGED_WRITE_BYTE_THRESHOLD) reasons.push(`file is ${bytes} bytes`);
  if (lineCount >= STAGED_WRITE_LINE_THRESHOLD) reasons.push(`file has ${lineCount} lines`);
  if (isSourceLike && (interpolationMarkers >= 4 || (interpolationMarkers >= 1 && bytes >= 4000))) {
    reasons.push(`source contains dense template/interpolation syntax (${interpolationMarkers} markers)`);
  }

  if (reasons.length) {
    return {
      recommendedMode: "exact-replace",
      tool: "relai_replace",
      fallbackMode: "staged-write",
      fallbackTool: "relai_write",
      alternatives: ["staged-write", "apply-update"],
      recommendedChunkBytes: DEFAULT_STAGED_CHUNK_BYTES,
      fileShape: { bytes, lineCount, extension: ext || "", interpolationMarkers },
      reasons,
      useWhen: "Use for localized edits inside this existing file.",
      wholeFileReplacement: {
        recommendedMode: "staged-write",
        tool: "relai_write",
        reason: "Use staged writes only when the complete file genuinely needs replacement."
      },
      multiFileChange: {
        recommendedMode: "apply-update",
        tool: "relai_edit",
        reason: "Use relai_edit with updateText (or edits: [...]) when the change spans multiple files."
      },
      next: "Prefer relai_replace with exact current text. Use staged relai_write for unavoidable whole-file replacement. Use relai_tidy_plan and relai_tidy_run for session-owned untracked artifacts."
    };
  }

  return {
    recommendedMode: "direct-write",
    tool: "relai_write",
    fallbackMode: "exact-replace",
    fallbackTool: "relai_replace",
    alternatives: ["exact-replace", "apply-update"],
    fileShape: { bytes, lineCount, extension: ext || "", interpolationMarkers },
    reasons: ["normal-sized file"],
    useWhen: "Use for complete replacement of this small or normal-sized file.",
    localizedEdit: {
      recommendedMode: "exact-replace",
      tool: "relai_replace",
      reason: "Use exact replacement when only a small block changes."
    },
    multiFileChange: {
      recommendedMode: "apply-update",
      tool: "relai_edit",
      reason: "Use relai_edit with updateText (or edits: [...]) when the change spans multiple files."
    },
    next: "Use direct relai_write for full-file replacement, or relai_replace for localized edits."
  };
}

function normalizeExactReplacements(args) {
  let replacements;
  if (Array.isArray(args.replacements)) {
    replacements = args.replacements;
  } else if (Object.hasOwn(args, "oldText") || Object.hasOwn(args, "newText")) {
    replacements = [{ oldText: args.oldText, newText: args.newText, occurrence: args.occurrence }];
  } else {
    throw new Error("relai_replace requires either { oldText, newText } or replacements: [{ oldText, newText, occurrence? }].");
  }
  if (!Array.isArray(replacements) || replacements.length === 0) throw new Error("relai_replace replacements must contain at least one operation.");
  if (replacements.length > EXACT_REPLACE_MAX_OPERATIONS) throw new Error(`relai_replace accepts at most ${EXACT_REPLACE_MAX_OPERATIONS} replacement operations.`);
  return replacements.map((item, index) => {
    const oldText = typeof item.oldText === "string" ? item.oldText : null;
    const newText = typeof item.newText === "string" ? item.newText : null;
    if (!oldText) throw new Error(`relai_replace operation ${index + 1} requires non-empty oldText.`);
    if (newText == null) throw new Error(`relai_replace operation ${index + 1} requires newText as a string. Use an empty string to clear text.`);
    if (Buffer.byteLength(oldText, "utf8") > EXACT_REPLACE_TEXT_BYTE_LIMIT) throw new Error(`relai_replace operation ${index + 1} oldText exceeds ${EXACT_REPLACE_TEXT_BYTE_LIMIT} bytes. Use a smaller exact block.`);
    if (Buffer.byteLength(newText, "utf8") > EXACT_REPLACE_TEXT_BYTE_LIMIT) throw new Error(`relai_replace operation ${index + 1} newText exceeds ${EXACT_REPLACE_TEXT_BYTE_LIMIT} bytes. Use smaller replacements or staged relai_write for unavoidable whole-file replacement.`);
    const occurrence = item.occurrence == null ? null : Number(item.occurrence);
    if (occurrence != null && (!Number.isInteger(occurrence) || occurrence < 1)) throw new Error(`relai_replace operation ${index + 1} occurrence must be a positive integer.`);
    return { oldText, newText, occurrence };
  });
}

function countStringOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const found = text.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
}

function replaceNth(text, oldText, newText, occurrence) {
  let cursor = 0;
  for (let seen = 1; seen <= occurrence; seen += 1) {
    const found = text.indexOf(oldText, cursor);
    if (found === -1) return text;
    if (seen === occurrence) {
      return text.slice(0, found) + newText + text.slice(found + oldText.length);
    }
    cursor = found + oldText.length;
  }
  return text;
}

function countMatches(text, pattern) {
  const matches = String(text || "").match(pattern);
  return matches ? matches.length : 0;
}

function countLines(text) {
  if (text === "") return 0;
  return String(text).split(/\r?\n/).length;
}

function sha256Text(text) {
  return require("node:crypto").createHash("sha256").update(String(text), "utf8").digest("hex");
}

module.exports = {
  repoSnapshot,
  relaiRead,
  relaiWrite,
  relaiReplace,
  relaiApplyPatch,
  relaiVerify,
  relaiBrowser,
  relaiDiff,
  relaiReset,
  relaiGitStatus,
  relaiGitCommit,
  relaiGitPush,
  relaiGitCreatePr,
  normalizeOpenAIPatchFormat,
  classifyStatusOwnership,
  STAGED_WRITE_BYTE_THRESHOLD,
  STAGED_WRITE_LINE_THRESHOLD,
  writeStagedPayload,
  readStagedPayload,
  clearStagedPayload,
  resolveStagedWriteId,
  workspaceTidyPlan,
  workspaceTidyRun: relaiWorkspaceTidyRun
};
