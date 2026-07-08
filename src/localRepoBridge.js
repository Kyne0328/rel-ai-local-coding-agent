const fs = require("node:fs");
const path = require("node:path");
const { runProcess, summarizeCommand } = require("./process");
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
const { normalizeCommandAlias } = require("./commandNormalizer");
const { selectValidationLevel } = require("./validationStrategy");
const { resolvePolicy } = require("./policyResolver");
const { resolveBudget } = require("./budgetResolver");
const sessionCache = require("./sessionCache");
const {
  relaiGitStatus, relaiGitFetch, relaiGitCommit, relaiGitPush,
  relaiGitMergeBranch, relaiGitMergeRemoteBranchesPlan, relaiGitAbortMerge, relaiGitCreatePr,
  classifyStatusOwnership,
  preparedFlag,
  workflowSummary, recommendedFlowForConfig,
  assertPreparedUpdateSafe, assertPreparedBundleSafe,
  ensureGitRepo, requireCleanGitIfConfigured, shouldMakePreparedBackup, makePreparedBackup,
  tempStateDir, tempStatePath, validatePatchPaths
} = require("./repo/gitOps");
const {
  resolveHostPath, buildZipCommand, buildUnzipCommand,
  extractZipArchive, createZipArchive, detectArchiveOverlayRoot,
  previewArchiveOverlay, overlayDirectory,
  shouldSkipArchivePath, copyWorkspaceForArchive
} = require("./repo/archiveUtils");
const { relaiRefactorAudit } = require("./repo/audit");

const DEFAULT_MAX_READ_BYTES = 1024 * 1024;
const DEFAULT_MAX_SNAPSHOT_FILES = 1000;
const DEFAULT_MAX_DIFF_BYTES = 1024 * 1024;
const DEFAULT_STAGED_CHUNK_BYTES = 12000;
const STAGED_WRITE_BYTE_THRESHOLD = 8000;
const STAGED_WRITE_LINE_THRESHOLD = 180;
const EXACT_REPLACE_TEXT_BYTE_LIMIT = 50000;
const EXACT_REPLACE_MAX_OPERATIONS = 50;
// Per-command output kept in a relai_run_checks result. The whole result is
// later capped by the server (MAX_TOOL_RESULT_CHARS); returning multi-MB logs
// makes the server head-truncate the result and cut the failing tail. We keep a
// bounded TAIL per command instead (errors/summaries live at the end), so the
// useful part survives. fullOutput keeps a larger tail but still stays bounded.
const CHECK_OUTPUT_TAIL_DEFAULT = 4000;
const CHECK_OUTPUT_TAIL_FULL = 40000;
const SOURCE_LIKE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.dart', '.py', '.go', '.rs', '.java', '.kt', '.swift', '.cs', '.cpp', '.c', '.h', '.hpp', '.rb', '.php', '.css', '.scss', '.html', '.xml', '.yaml', '.yml', '.json', '.md']);
const TIDY_PLAN_TTL_MS = 15 * 60 * 1000;
const TIDY_PLAN_ID_PATTERN = /^tidy_[a-z0-9]+_[a-f0-9]{12}$/;
const TIDY_MODES = new Set(["session_untracked"]);

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
    flow: workflowSummary(config),
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
    recommendedFlow: recommendedFlowForConfig(config),
    writeGuidance: workspaceWriteGuidance(config),
    operationJournal: summarizeOperations(config, workspace, args.journalLimit || 10)
  };
}

function relaiRead(workspace, config, args = {}) {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (paths.length === 0) throw new Error("paths must contain at least one path.");
  const policy = resolvePolicy(workspace, config || {});
  const sessionActive = policy && policy.sessionActive === true;
  const defaultMaxBytes = resolveBudget(DEFAULT_MAX_READ_BYTES, policy, config || {});
  const maxBytes = clampNumber(args.maxBytes, 1000, 10 * 1024 * 1024, defaultMaxBytes);
  const items = [];
  const skipped = [];
  for (const requested of paths) {
    try {
      const safe = resolveSafePath(workspace.path, requested);
      const stat = fs.statSync(safe.absolutePath);
      if (stat.isDirectory()) {
        items.push(readDirectory(workspace, safe.relativePath, args));
        continue;
      }
      if (!stat.isFile()) {
        skipped.push({ path: String(requested), reason: "not a file or directory" });
        continue;
      }

      let text = null;
      let cacheHit = false;
      if (sessionActive) {
        const cached = sessionCache.getCachedRead(workspace.alias, safe.absolutePath, stat.mtimeMs);
        if (cached !== null) { text = cached; cacheHit = true; }
      }
      let data = null;
      if (text === null) {
        data = fs.readFileSync(safe.absolutePath);
        if (looksBinary(data)) {
          skipped.push({ path: safe.relativePath, reason: "binary-looking file" });
          continue;
        }
        text = data.toString("utf8");
        if (sessionActive) {
          sessionCache.setCachedRead(workspace.alias, safe.absolutePath, stat.mtimeMs, text);
        }
      }

      const byteLen = Buffer.byteLength(text, "utf8");
      const truncated = byteLen > maxBytes;
      const item = {
        type: "file",
        path: safe.relativePath,
        sha256: fileSha256(workspace.path, safe.relativePath),
        bytes: data ? data.length : byteLen,
        lineCount: countLines(text),
        truncated,
        writeGuidance: fileWriteGuidance(safe.relativePath, text),
        content: truncated ? text.slice(0, maxBytes) : text
      };
      if (sessionActive) item.cacheHit = cacheHit;
      items.push(item);
    } catch (error) {
      skipped.push({ path: String(requested), reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ok: true, workspace: workspace.alias, items, skipped };
}

function relaiWrite(workspace, config, args = {}) {
  const stage = String(args.stage || "direct").trim().toLowerCase();
  if (stage === "direct" || stage === "") {
    const relativePath = String(args.path || "").trim();
    if (!relativePath) throw new Error("relai_write requires path and content. Expected: { workspace, path, content }.");
    if (typeof args.content !== "string") throw new Error("relai_write requires content as a string containing the entire target file. Expected: { workspace, path, content }.");
    assertDirectWriteAllowed(relativePath, args.content);
    return performFullFileWrite(workspace, config, relativePath, args.content, { dryRun: Boolean(args.dryRun) });
  }

  if (stage === "start") {
    const relativePath = String(args.path || "").trim();
    if (!relativePath) throw new Error("relai_write stage='start' requires path and content.");
    if (typeof args.content !== "string") throw new Error("relai_write stage='start' requires a content chunk string.");
    const safe = resolveSafePath(workspace.path, relativePath);
    const writeId = makeOperationId();
    writeStagedPayload(config, workspace, writeId, {
      id: writeId,
      workspace: workspace.alias,
      root: workspace.path,
      path: safe.relativePath,
      chunks: [args.content],
      bytes: Buffer.byteLength(args.content, "utf8"),
      createdAt: new Date().toISOString()
    });
    return {
      ok: true,
      workspace: workspace.alias,
      path: safe.relativePath,
      operation: "stagedFullFileWrite:start",
      writeId,
      chunks: 1,
      bytes: Buffer.byteLength(args.content, "utf8"),
      next: "Call relai_write with { workspace, stage: 'append', writeId, content } for more chunks, then { workspace, stage: 'commit', writeId } to write the complete file."
    };
  }

  if (stage === "append") {
    if (typeof args.content !== "string") throw new Error("relai_write stage='append' requires writeId and a content chunk string.");
    const writeId = resolveStagedWriteId(config, workspace, args.writeId, args.path);
    const payload = readStagedPayload(config, workspace, writeId);
    payload.chunks.push(args.content);
    payload.bytes += Buffer.byteLength(args.content, "utf8");
    payload.updatedAt = new Date().toISOString();
    writeStagedPayload(config, workspace, writeId, payload);
    return {
      ok: true,
      workspace: workspace.alias,
      path: payload.path,
      operation: "stagedFullFileWrite:append",
      writeId,
      chunks: payload.chunks.length,
      bytes: payload.bytes,
      next: "Append more chunks or call relai_write with { workspace, stage: 'commit', writeId }."
    };
  }

  if (stage === "commit") {
    const writeId = resolveStagedWriteId(config, workspace, args.writeId, args.path);
    const payload = readStagedPayload(config, workspace, writeId);
    const content = payload.chunks.join("");
    const result = performFullFileWrite(workspace, config, payload.path, content, { dryRun: Boolean(args.dryRun), staged: true, writeId });
    if (!args.dryRun) clearStagedPayload(config, workspace, writeId);
    return {
      ...result,
      operation: "stagedFullFileWrite:commit",
      writeId,
      staged: true,
      chunks: payload.chunks.length,
      bytes: Buffer.byteLength(content, "utf8")
    };
  }

  if (stage === "abort") {
    const writeId = validateWriteId(args.writeId);
    const existed = clearStagedPayload(config, workspace, writeId);
    return { ok: true, workspace: workspace.alias, operation: "stagedFullFileWrite:abort", writeId, cleared: existed };
  }

  throw new Error("relai_write stage must be one of: direct, start, append, commit, abort.");
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
  let nextContent = oldContent;
  const results = [];

  for (let index = 0; index < replacements.length; index += 1) {
    const item = replacements[index];
    const before = nextContent;
    const totalMatches = countStringOccurrences(before, item.oldText);
    if (totalMatches === 0) {
      throw new Error(`relai_replace operation ${index + 1} found 0 matches in ${safe.relativePath}. Re-read the file and use exact current text.`);
    }
    const hasExplicitOccurrence = item.occurrence != null;
    if (!hasExplicitOccurrence && totalMatches !== 1) {
      throw new Error(`relai_replace operation ${index + 1} found ${totalMatches} matches in ${safe.relativePath}. Pass occurrence to replace exactly one match, or use a larger unique oldText block.`);
    }
    const occurrence = hasExplicitOccurrence ? item.occurrence : 1;
    if (occurrence > totalMatches) {
      throw new Error(`relai_replace operation ${index + 1} requested occurrence ${occurrence}, but only ${totalMatches} matches exist in ${safe.relativePath}.`);
    }
    nextContent = replaceNth(before, item.oldText, item.newText, occurrence);
    results.push({
      index: index + 1,
      matchesBefore: totalMatches,
      occurrence,
      oldBytes: Buffer.byteLength(item.oldText, "utf8"),
      newBytes: Buffer.byteLength(item.newText, "utf8"),
      changed: nextContent !== before
    });
  }

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

function relaiClear(workspace, config, args = {}) {
  const rawPaths = Array.isArray(args.paths) ? args.paths : (args.path ? [args.path] : []);
  if (rawPaths.length === 0) throw new Error("relai_clear_files requires path or paths.");
  if (rawPaths.length > 100) throw new Error("relai_clear_files accepts at most 100 paths per call.");
  const dryRun = Boolean(args.dryRun);
  const failIfMissing = Boolean(args.failIfMissing);
  const expectedSha256 = String(args.expectedSha256 || "").trim();
  if (expectedSha256 && rawPaths.length !== 1) throw new Error("relai_clear_files expectedSha256 can only be used with one path.");

  const operationId = makeOperationId();
  const cleared = [];
  const wouldClear = [];
  const skipped = [];
  const results = [];

  for (const rawPath of rawPaths) {
    const safe = resolveSafePath(workspace.path, String(rawPath || "").trim());
    if (!fs.existsSync(safe.absolutePath)) {
      const item = { path: safe.relativePath, skipped: true, reason: "missing" };
      skipped.push(item);
      if (failIfMissing) throw new Error(`relai_clear_files target does not exist: ${safe.relativePath}`);
      results.push(item);
      continue;
    }
    const stat = fs.statSync(safe.absolutePath);
    if (!stat.isFile()) throw new Error(`relai_clear_files refuses non-file path: ${safe.relativePath}`);
    const oldSha256 = fileSha256(workspace.path, safe.relativePath);
    const shaMismatch = Boolean(expectedSha256 && oldSha256 !== expectedSha256);
    const item = { path: safe.relativePath, cleared: !dryRun, dryRun, oldSha256, ...(shaMismatch ? { shaMismatch: { expectedSha256, currentSha256: oldSha256 } } : {}) };
    wouldClear.push(safe.relativePath);
    if (!dryRun) {
      fs.rmSync(safe.absolutePath, { force: true });
      cleared.push(safe.relativePath);
    }
    results.push(item);
  }

  appendOperation(config, workspace, {
    id: operationId,
    type: dryRun ? "clear:dryRun" : "clear",
    ok: true,
    paths: cleared,
    results
  });

  return {
    ok: true,
    dryRun,
    workspace: workspace.alias,
    operationId,
    operation: "clearFiles",
    changed: !dryRun && cleared.length > 0,
    changedFiles: cleared,
    cleared,
    wouldClear: dryRun ? wouldClear : [],
    skipped,
    results
  };
}

function tidyPlanDir(config, workspace) {
  const safeAlias = String(workspace.alias || "workspace").replace(/[^A-Za-z0-9_.-]/g, "_");
  return path.join(getStateDir(config), "workspace-tidy", safeAlias);
}

function validateTidyPlanId(planId) {
  const text = String(planId || "").trim();
  if (!TIDY_PLAN_ID_PATTERN.test(text)) throw new Error("Invalid or missing workspace tidy planId.");
  return text;
}

function tidyPlanPath(config, workspace, planId) {
  return path.join(tidyPlanDir(config, workspace), `${validateTidyPlanId(planId)}.json`);
}

function makeTidyPlanId() {
  return `tidy_${Date.now().toString(36)}_${require("node:crypto").randomBytes(6).toString("hex")}`;
}

function normalizeTidyMode(raw) {
  const mode = String(raw || "session_untracked").trim().toLowerCase();
  if (!TIDY_MODES.has(mode)) throw new Error(`Unsupported tidy mode '${mode}'. Supported modes: ${[...TIDY_MODES].join(", ")}.`);
  return mode;
}

async function workspaceTidyPlan(workspace, config, args = {}) {
  const mode = normalizeTidyMode(args.mode);
  const maxCandidates = clampNumber(args.maxCandidates, 1, 100, 50);
  const status = await runProcess("git", ["status", "--short", "--branch"], { cwd: workspace.path, timeout: 30000 }, config);
  if (status.exitCode !== 0) throw new Error(`git status failed for ${workspace.alias}: ${status.stderr || status.stdout || status.exitCode}`);
  const ownership = classifyStatusOwnership(workspace, config, status.stdout || "");
  // Without a captured session baseline we cannot distinguish this agent's
  // untracked artifacts from pre-existing user files. Refuse rather than risk
  // planning a delete of files the user created before any session started.
  if (mode === "session_untracked" && !ownership.hasSession) {
    return {
      ok: false,
      workspace: workspace.alias,
      operation: "workspaceTidyPlan",
      mode,
      candidateCount: 0,
      candidates: [],
      skipped: [],
      reason: "no_session_baseline",
      message: "No active session baseline for this workspace, so untracked files cannot be attributed to this session. Start a session (edit a file, or call relai_set_policy) before tidying session-owned untracked files."
    };
  }
  const candidates = [];
  const skipped = [];
  if (mode === "session_untracked") {
    for (const file of ownership.untrackedSession.slice(0, maxCandidates)) {
      try {
        const safe = resolveSafePath(workspace.path, file);
        if (!fs.existsSync(safe.absolutePath)) { skipped.push({ path: safe.relativePath, reason: "missing" }); continue; }
        const stat = fs.statSync(safe.absolutePath);
        if (!stat.isFile()) { skipped.push({ path: safe.relativePath, reason: "not a file" }); continue; }
        candidates.push({
          path: safe.relativePath,
          action: "tidy_untracked_file",
          status: "untracked",
          owner: "session",
          reason: "untracked file owned by the current workspace session",
          sha256: fileSha256(workspace.path, safe.relativePath),
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString()
        });
      } catch (error) {
        skipped.push({ path: String(file), reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  const now = Date.now();
  const planId = makeTidyPlanId();
  const plan = {
    id: planId,
    workspace: workspace.alias,
    root: workspace.path,
    mode,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TIDY_PLAN_TTL_MS).toISOString(),
    candidates,
    skipped
  };
  fs.mkdirSync(tidyPlanDir(config, workspace), { recursive: true, mode: 0o700 });
  fs.writeFileSync(tidyPlanPath(config, workspace, planId), `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  appendOperation(config, workspace, {
    id: planId,
    type: "workspace_tidy_plan",
    ok: true,
    paths: [],
    results: [{ operation: "workspaceTidyPlan", mode, candidateCount: candidates.length }]
  });
  return {
    ok: true,
    workspace: workspace.alias,
    operation: "workspaceTidyPlan",
    mode,
    planId,
    expiresAt: plan.expiresAt,
    ttlSeconds: Math.floor(TIDY_PLAN_TTL_MS / 1000),
    candidateCount: candidates.length,
    skippedCount: skipped.length,
    candidates,
    skipped,
    next: candidates.length ? "Call relai_tidy_run with this planId to apply this bounded tidy plan." : "No session-owned untracked files were found."
  };
}

function readTidyPlan(config, workspace, planId) {
  const id = validateTidyPlanId(planId);
  const file = tidyPlanPath(config, workspace, id);
  if (!fs.existsSync(file)) throw new Error(`Workspace tidy plan not found or already used: ${id}`);
  const plan = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!plan || plan.id !== id) throw new Error(`Workspace tidy plan file is invalid: ${id}`);
  if (plan.workspace !== workspace.alias || plan.root !== workspace.path) throw new Error(`Workspace tidy plan ${id} belongs to a different workspace.`);
  const expires = Date.parse(plan.expiresAt || "");
  if (!Number.isFinite(expires) || Date.now() > expires) throw new Error(`Workspace tidy plan ${id} expired. Create a new plan first.`);
  return { file, plan };
}

async function relaiWorkspaceTidyRun(workspace, config, args = {}) {
  const planId = validateTidyPlanId(args.planId);
  const { file, plan } = readTidyPlan(config, workspace, planId);
  const status = await runProcess("git", ["status", "--short", "--branch"], { cwd: workspace.path, timeout: 30000 }, config);
  if (status.exitCode !== 0) throw new Error(`git status failed for ${workspace.alias}: ${status.stderr || status.stdout || status.exitCode}`);
  const ownership = classifyStatusOwnership(workspace, config, status.stdout || "");
  const currentUntracked = new Set(ownership.untrackedSession || []);
  const candidates = Array.isArray(plan.candidates) ? plan.candidates : [];
  const preflight = [];
  const refused = [];
  for (const candidate of candidates) {
    const safe = resolveSafePath(workspace.path, candidate.path);
    if (!currentUntracked.has(safe.relativePath)) { refused.push({ path: safe.relativePath, reason: "path is no longer session-owned and untracked" }); continue; }
    if (!fs.existsSync(safe.absolutePath)) { refused.push({ path: safe.relativePath, reason: "path is missing" }); continue; }
    const stat = fs.statSync(safe.absolutePath);
    if (!stat.isFile()) { refused.push({ path: safe.relativePath, reason: "path is not a file" }); continue; }
    const currentSha256 = fileSha256(workspace.path, safe.relativePath);
    if (currentSha256 !== candidate.sha256) { refused.push({ path: safe.relativePath, reason: "sha256 mismatch", expectedSha256: candidate.sha256, currentSha256 }); continue; }
    preflight.push({ path: safe.relativePath, sha256: currentSha256, sizeBytes: stat.size });
  }
  if (refused.length > 0) {
    return {
      ok: false,
      workspace: workspace.alias,
      operation: "workspaceTidyApply:preflight",
      planId,
      changed: false,
      changedFiles: [],
      applied: [],
      refused,
      message: "Workspace tidy plan was not applied because one or more candidates changed since planning. Create a fresh plan."
    };
  }
  const clearResult = (preflight.length > 0 ? relaiClear(workspace, config, { paths: preflight.map((item) => item.path), failIfMissing: true }) : { ok: true, changedFiles: [] });
  try { fs.rmSync(file, { force: true }); } catch (_error) {}
  const applied = preflight.map((item) => ({ path: item.path, action: "tidied_untracked_file", sha256: item.sha256, sizeBytes: item.sizeBytes }));
  appendOperation(config, workspace, {
    id: planId,
    type: "workspace_tidy_apply",
    ok: clearResult.ok === true,
    paths: clearResult.changedFiles || [],
    results: [{ operation: "workspaceTidyApply", appliedCount: applied.length }]
  });
  return {
    ok: clearResult.ok === true,
    workspace: workspace.alias,
    operation: "workspaceTidyApply",
    planId,
    changed: applied.length > 0,
    changedFiles: clearResult.changedFiles || [],
    appliedCount: applied.length,
    applied,
    message: applied.length ? `Applied workspace tidy plan to ${applied.length} file(s).` : "Workspace tidy plan had no candidates."
  };
}

async function relaiApplyPatch(workspace, config, args = {}) {
  const rawPatch = String(args.patch || args.diff || args.updateText || "");
  assertPreparedUpdateSafe(workspace, config, args, rawPatch);
  if (/^\s*\*\*\* Begin Patch\b/m.test(rawPatch)) {
    return applyStructuredOpenAIPatch(workspace, config, args, rawPatch);
  }
  const patch = normalizeUnifiedDiffText(rawPatch);
  const patchBytes = Buffer.byteLength(patch, "utf8");
  await ensureGitRepo(workspace, config);
  const touchedPaths = validatePatchPaths(workspace, patch);
  await requireCleanGitIfConfigured(workspace, config, args);
  const operationId = makeOperationId();
  const patchFile = tempStatePath(config, workspace, operationId, ".patch");
  fs.writeFileSync(patchFile, patch, "utf8");
  const check = await runProcess("git", ["apply", "--check", "--verbose", "--recount", patchFile], { cwd: workspace.path, timeout: clampNumber(args.timeoutMs, 1000, 86400000, 120000) }, config);
  if (check.exitCode !== 0) {
    return {
      ok: false,
      workspace: workspace.alias,
      operationId,
      operation: "applyPatch:check",
      touchedPaths,
      check: summarizeCommand(check),
      diagnostics: diagnosePatchFailure(check.stderr || check.stdout || "", patch, touchedPaths)
    };
  }
  if (args.dryRun) {
    appendOperation(config, workspace, { id: operationId, type: "apply_patch:dryRun", ok: true, paths: [], results: [{ operation: "applyPatch:dryRun", bytes: patchBytes, touchedPaths, changedFiles: [] }] });
    return {
      ok: true,
      dryRun: true,
      workspace: workspace.alias,
      operationId,
      operation: "applyPatch:dryRun",
      changedFiles: [],
      touchedPaths,
      patchBytes,
      check: summarizeCommand(check),
      sourceFormat: "unified-diff"
    };
  }
  let backup = null;
  if (shouldMakePreparedBackup(config, args)) backup = await makePreparedBackup(workspace, config, operationId, "patch");
  // Capture content hashes before apply so changedFiles reflects ACTUAL changes,
  // not every path the patch touches — a semantic no-op patch applies cleanly but
  // must report changedFiles:[].
  const hashOf = (rel) => (fs.existsSync(path.join(workspace.path, rel)) ? fileSha256(workspace.path, rel) : null);
  const beforeHashes = new Map(touchedPaths.map((rel) => [rel, hashOf(rel)]));
  const apply = await runProcess("git", ["apply", patchFile], { cwd: workspace.path, timeout: clampNumber(args.timeoutMs, 1000, 86400000, 120000) }, config);
  const changedFiles = apply.exitCode === 0
    ? touchedPaths.filter((rel) => hashOf(rel) !== beforeHashes.get(rel))
    : [];
  const verify = hasRequestedChecks(args) ? await relaiVerify(workspace, config, args) : null;
  const diff = args.returnDiff === false ? null : await relaiDiff(workspace, config, { maxBytes: args.maxDiffBytes || DEFAULT_MAX_DIFF_BYTES });
  const ok = apply.exitCode === 0 && (!verify || verify.ok);
  appendOperation(config, workspace, { id: operationId, type: "apply_patch", ok, paths: changedFiles, results: [{ operation: "applyPatch", bytes: patchBytes, touchedPaths, changedFiles, verified: verify ? verify.ok : null }] });
  return { ok, workspace: workspace.alias, operationId, operation: "applyPatch", changedFiles, touchedPaths, patchBytes, backup, apply: summarizeCommand(apply), sourceFormat: "unified-diff", ...(verify ? { verify } : {}), ...(diff ? { diff } : {}) };
}

function normalizeOpenAIPatchFormat(input) {
  const text = String(input || "");
  if (!/^\s*\*\*\* Begin Patch\b/m.test(text)) {
    return { patch: text, converted: false, sourceFormat: "unified-diff" };
  }
  const lines = text.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length && !/^\s*\*\*\* Begin Patch\b/.test(lines[i])) i += 1;
  i += 1;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\*\*\* End Patch\b/.test(line)) break;
    const updateMatch = /^\s*\*\*\* Update File:\s*(.+)$/.exec(line);
    const addMatch = /^\s*\*\*\* Add File:\s*(.+)$/.exec(line);
    const delMatch = /^\s*\*\*\* Delete File:\s*(.+)$/.exec(line);
    if (updateMatch) {
      const filePath = updateMatch[1].trim();
      out.push(`--- a/${filePath}`);
      out.push(`+++ b/${filePath}`);
      i += 1;
      while (i < lines.length && !/^\s*\*\*\* /.test(lines[i])) {
        out.push(lines[i]);
        i += 1;
      }
      continue;
    }
    if (addMatch) {
      const filePath = addMatch[1].trim();
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*\*\*\* /.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      const contentLines = body.map((l) => (l.startsWith("+") ? l.slice(1) : l));
      out.push(`--- /dev/null`);
      out.push(`+++ b/${filePath}`);
      out.push(`@@ -0,0 +1,${contentLines.length} @@`);
      for (const cl of contentLines) out.push(`+${cl}`);
      continue;
    }
    if (delMatch) {
      throw new Error(`OpenAI patch 'Delete File' is not supported in relai_apply_update. Use relai_clear_files { paths: ["${delMatch[1].trim()}"] } instead.`);
    }
    i += 1;
  }
  return { patch: `${out.join("\n")}\n`, converted: true, sourceFormat: "openai-patch" };
}

async function applyStructuredOpenAIPatch(workspace, config, args, rawPatch) {
  const document = parseOpenAIPatchDocument(rawPatch);
  const touchedPaths = document.operations.map((item) => item.path);
  await requireCleanGitIfConfigured(workspace, config, args);
  const operationId = makeOperationId();
  let backup = null;
  if (shouldMakePreparedBackup(config, args)) backup = await makePreparedBackup(workspace, config, operationId, "patch");
  const changedFiles = [];
  for (const operation of document.operations) {
    const safe = resolveSafePath(workspace.path, operation.path);
    const exists = fs.existsSync(safe.absolutePath);
    const oldText = exists ? fs.readFileSync(safe.absolutePath, "utf8").replace(/\r\n/g, "\n") : "";
    if (operation.type === "update") {
      const nextText = applyOpenAIPatchUpdate(oldText, operation, safe.relativePath);
      if (nextText !== oldText) {
        if (!args.dryRun) writeTextFileSafe(workspace.path, safe.relativePath, nextText);
        changedFiles.push(safe.relativePath);
      }
      continue;
    }
    if (operation.type === "add") {
      const nextText = joinPatchLines(operation.lines.map((line) => line.slice(1)), true);
      if (!args.dryRun) writeTextFileSafe(workspace.path, safe.relativePath, nextText);
      changedFiles.push(safe.relativePath);
      continue;
    }
    if (operation.type === "delete") {
      if (!args.dryRun) fs.rmSync(safe.absolutePath, { force: true });
      changedFiles.push(safe.relativePath);
    }
  }
  const verify = hasRequestedChecks(args) ? await relaiVerify(workspace, config, args) : null;
  const diff = args.returnDiff === false ? null : await relaiDiff(workspace, config, { maxBytes: args.maxDiffBytes || DEFAULT_MAX_DIFF_BYTES });
  const ok = !verify || verify.ok;
  appendOperation(config, workspace, { id: operationId, type: "apply_patch", ok, paths: changedFiles, results: [{ operation: "applyPatch", bytes: Buffer.byteLength(rawPatch, "utf8"), touchedPaths: changedFiles, verified: verify ? verify.ok : null }] });
  return {
    ok,
    workspace: workspace.alias,
    operationId,
    operation: "applyPatch",
    sourceFormat: "openai-patch",
    converted: false,
    patchBytes: Buffer.byteLength(rawPatch, "utf8"),
    changedFiles,
    touchedPaths,
    backup,
    ...(verify ? { verify } : {}),
    ...(diff ? { diff } : {})
  };
}

function parseOpenAIPatchDocument(input) {
  const lines = String(input || "").replace(/\r\n/g, "\n").split("\n");
  const operations = [];
  let index = lines.findIndex((line) => /^\s*\*\*\* Begin Patch\b/.test(line));
  if (index === -1) throw new Error("OpenAI patch is missing '*** Begin Patch'.");
  index += 1;
  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*\*\*\* End Patch\b/.test(line)) break;
    const updateMatch = /^\s*\*\*\* Update File:\s*(.+)$/.exec(line);
    const addMatch = /^\s*\*\*\* Add File:\s*(.+)$/.exec(line);
    const deleteMatch = /^\s*\*\*\* Delete File:\s*(.+)$/.exec(line);
    if (!updateMatch && !addMatch && !deleteMatch) {
      index += 1;
      continue;
    }
    const type = updateMatch ? "update" : addMatch ? "add" : "delete";
    const pathText = (updateMatch || addMatch || deleteMatch)[1].trim();
    const body = [];
    index += 1;
    while (index < lines.length && !/^\s*\*\*\* (Update File|Add File|Delete File|End Patch)\b/.test(lines[index])) {
      body.push(lines[index]);
      index += 1;
    }
    operations.push({ type, path: pathText, lines: body });
  }
  if (operations.length === 0) {
    throw new Error("OpenAI patch did not contain any file operations.");
  }
  return { operations };
}

function applyOpenAIPatchUpdate(oldText, operation, relativePath) {
  const oldEndsWithNewline = /\n$/.test(oldText);
  const oldLines = splitPatchText(oldText);
  const hunks = [];
  let current = [];
  for (const line of operation.lines) {
    if (line === "*** End of File") continue;
    if (line.startsWith("@@")) {
      if (current.length > 0) {
        hunks.push(current);
        current = [];
      }
      continue;
    }
    if (/^[ +-]/.test(line)) {
      current.push(line);
      continue;
    }
    if (line.trim() === "") {
      current.push(" ");
      continue;
    }
    throw new Error(`OpenAI patch update for ${relativePath} contains an unsupported line: ${line}`);
  }
  if (current.length > 0) hunks.push(current);
  if (hunks.length === 0) throw new Error(`OpenAI patch update for ${relativePath} did not contain any hunks.`);

  let cursor = 0;
  const output = [];
  for (const hunk of hunks) {
    const matchLines = hunk.filter((line) => !line.startsWith("+")).map((line) => line.slice(1));
    const start = findHunkStart(oldLines, matchLines, cursor);
    if (start === -1) {
      throw new Error(`OpenAI patch context mismatch for ${relativePath}. Re-read the file and regenerate the patch with current text.`);
    }
    output.push(...oldLines.slice(cursor, start));
    let lineIndex = start;
    for (const line of hunk) {
      const prefix = line[0];
      const content = line.slice(1);
      if (prefix === " ") {
        if (oldLines[lineIndex] !== content) {
          throw new Error(`OpenAI patch context mismatch for ${relativePath} at '${content}'.`);
        }
        output.push(content);
        lineIndex += 1;
      } else if (prefix === "-") {
        if (oldLines[lineIndex] !== content) {
          throw new Error(`OpenAI patch delete mismatch for ${relativePath} at '${content}'.`);
        }
        lineIndex += 1;
      } else if (prefix === "+") {
        output.push(content);
      }
    }
    cursor = lineIndex;
  }
  output.push(...oldLines.slice(cursor));
  return joinPatchLines(output, oldEndsWithNewline);
}

function splitPatchText(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  if (!normalized) return [];
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  return lines;
}

function joinPatchLines(lines, endsWithNewline) {
  const body = lines.join("\n");
  return endsWithNewline ? `${body}\n` : body;
}

function findHunkStart(lines, matchLines, fromIndex) {
  if (matchLines.length === 0) return fromIndex;
  for (let index = fromIndex; index <= lines.length - matchLines.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < matchLines.length; offset += 1) {
      if (lines[index + offset] !== matchLines[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return index;
  }
  return -1;
}

function normalizeUnifiedDiffText(input) {
  return String(input || "").replace(/\r\n/g, "\n");
}

function diagnosePatchFailure(stderrText, patch, touchedPaths) {
  const text = String(stderrText || "");
  const diagnostics = [];
  if (/corrupt patch/i.test(text)) diagnostics.push("Patch hunks are malformed or incomplete.");
  if (/patch does not apply/i.test(text)) diagnostics.push("Patch context does not match the current file contents.");
  if (/No such file or directory/i.test(text)) diagnostics.push("One or more patch paths do not exist in the workspace.");
  if (/unrecognized input/i.test(text)) diagnostics.push("Patch format was not recognized by git apply.");
  if (/\r/.test(patch)) diagnostics.push("Patch contained CRLF line endings; convert to LF before applying.");
  if (!/^--- a\//m.test(patch) || !/^\+\+\+ b\//m.test(patch)) diagnostics.push("Unified diff headers must include --- a/path and +++ b/path lines.");
  if (diagnostics.length === 0) diagnostics.push("Re-read the target files and regenerate the patch with current context.");
  return { touchedPaths, diagnostics, raw: text.trim() };
}

async function relaiApplyArchive(workspace, config, args = {}) {
  const archivePath = resolveHostPath(String(args.archivePath || args.bundlePath || args.path || "").trim());
  if (!archivePath) throw new Error("relai_apply_bundle requires bundlePath pointing to a local zip archive on the MCP host.");
  if (!fs.existsSync(archivePath)) throw new Error(`Archive not found: ${archivePath}`);
  const stat = fs.statSync(archivePath);
  assertPreparedBundleSafe(workspace, config, args, archivePath, stat);
  await ensureGitRepo(workspace, config);
  await requireCleanGitIfConfigured(workspace, config, args);
  const operationId = makeOperationId();
  const tempRoot = tempStateDir(config, workspace, operationId, "archive");
  const extractedRoot = path.join(tempRoot, "extracted");
  fs.mkdirSync(extractedRoot, { recursive: true, mode: 0o700 });
  const extract = await extractZipArchive(archivePath, extractedRoot, config, args);
  if (!extract.ok) return { ok: false, workspace: workspace.alias, operationId, operation: "applyArchive:extract", archivePath, extract };
  const overlayRoot = args.stripRoot === false ? extractedRoot : detectArchiveOverlayRoot(extractedRoot);
  const clearMissing = Boolean(args.clearMissing ?? preparedFlag(config, "clearMissingDefault", false));
  if (args.dryRun) {
    const overlayPreview = previewArchiveOverlay(workspace.path, overlayRoot, { clearMissing });
    appendOperation(config, workspace, { id: operationId, type: "apply_archive:dryRun", ok: overlayPreview.errors.length === 0, paths: [], results: [{ operation: "applyArchive:dryRun", archivePath, copied: overlayPreview.wouldCopy.length, cleared: overlayPreview.wouldClear.length, skipped: overlayPreview.skipped.length }] });
    return { ok: overlayPreview.errors.length === 0, dryRun: true, workspace: workspace.alias, operationId, operation: "applyArchive:dryRun", archivePath, bundlePath: archivePath, archiveBytes: stat.size, changedFiles: [], overlayPreview, extract };
  }
  let backup = null;
  if (shouldMakePreparedBackup(config, args)) backup = await makePreparedBackup(workspace, config, operationId, "archive");
  const overlay = overlayDirectory(workspace.path, overlayRoot, { clearMissing });
  const verify = hasRequestedChecks(args) ? await relaiVerify(workspace, config, args) : null;
  const diff = args.returnDiff === false ? null : await relaiDiff(workspace, config, { maxBytes: args.maxDiffBytes || DEFAULT_MAX_DIFF_BYTES });
  const ok = overlay.errors.length === 0 && (!verify || verify.ok);
  appendOperation(config, workspace, { id: operationId, type: "apply_archive", ok, paths: overlay.changedFiles, results: [{ operation: "applyArchive", archivePath, copied: overlay.copied.length, cleared: overlay.cleared.length, skipped: overlay.skipped.length, verified: verify ? verify.ok : null }] });
  return { ok, workspace: workspace.alias, operationId, operation: "applyArchive", archivePath, bundlePath: archivePath, archiveBytes: stat.size, backup, changedFiles: overlay.changedFiles, overlay, ...(verify ? { verify } : {}), ...(diff ? { diff } : {}) };
}

async function relaiSnapshotArchive(workspace, config, args = {}) {
  const operationId = makeOperationId();
  const tempRoot = tempStateDir(config, workspace, operationId, "snapshot");
  const staging = path.join(tempRoot, "repo");
  fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
  const copied = copyWorkspaceForArchive(workspace.path, staging, { maxFiles: clampNumber(args.maxFiles, 1, 200000, 50000) });
  const archivePath = path.join(tempRoot, `${workspace.alias}-${operationId}.zip`);
  const zipped = await createZipArchive(staging, archivePath, config, args);
  const ok = zipped.ok === true;
  appendOperation(config, workspace, { id: operationId, type: "snapshot_archive", ok, paths: [], results: [{ operation: "snapshotArchive", archivePath, files: copied.files.length, skipped: copied.skipped.length }] });
  // Keep files/skipped as ARRAYS (consumers and tests iterate them, e.g. .map(f => f.path))
  // but cap their length so a huge repo cannot flood the response; siblings carry the
  // true totals and a truncated flag.
  const LIST_CAP = 50;
  const capList = (list) => (list.length > LIST_CAP ? list.slice(0, LIST_CAP) : list);
  const copiedSummary = {
    fileCount: copied.files.length,
    files: capList(copied.files),
    filesTruncated: copied.files.length > LIST_CAP,
    skippedCount: copied.skipped.length,
    skipped: capList(copied.skipped),
    skippedTruncated: copied.skipped.length > LIST_CAP
  };
  return { ok, workspace: workspace.alias, operationId, operation: "snapshotArchive", archivePath, copied: copiedSummary, zip: zipped, bytes: fs.existsSync(archivePath) ? fs.statSync(archivePath).size : 0, note: "Archive is stored on the MCP host. Use relai_apply_bundle with bundlePath to overlay it onto a workspace, or retrieve it from this local path." };
}

function assertDirectWriteAllowed(relativePath, content) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
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
  } catch (_) {
    return null;
  }
}

function stagedAmbiguityError(candidates, suppliedId) {
  if (!candidates.length) {
    return new Error(`No staged relai_write payload found${suppliedId ? ` for writeId ${suppliedId}` : ""}. Start a staged write with stage='start' first, or use a direct write { stage: 'direct', path, content } (direct write has no size cap).`);
  }
  const list = candidates.map((item) => `${item.id} → ${item.path || "(unknown path)"}`).join("; ");
  return new Error(`Multiple staged relai_write payloads are pending; refusing to guess which to use. Pass the exact writeId, or the target path, for the one you mean. Pending: ${list}.`);
}

function listStagedPayloads(config, workspace) {
  const dir = stagedDir(config, workspace);
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  const now = Date.now();
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    if (!/^op_[a-z0-9]+_[a-f0-9]{12}$/.test(id)) continue;
    const file = path.join(dir, name);
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch (_) {}
    if (mtime && (now - mtime) > STAGED_PRUNE_TTL_MS) {
      try { fs.rmSync(file, { force: true }); } catch (_) {}
      continue;
    }
    let payload;
    try { payload = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { continue; }
    out.push({ id, path: payload.path || null, mtime, ageMs: mtime ? now - mtime : null });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
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

async function relaiVerify(workspace, config, args = {}) {
  const level = String(args.level || "standard").toLowerCase();
  const { checks, aliasNormalizations } = normalizeVerifyChecks(args, workspace.path, level);
  const { level: validationLevel, reason: validationLevelReason, changedFiles } = selectValidationLevel(workspace.path, workspace, args.validationLevel);
  const policy = resolvePolicy(workspace, config);
  if (checks.length === 0) return {
    ok: false,
    workspace: workspace.alias,
    level,
    checks: [],
    commands: [],
    results: [],
    aliasNormalizations: 0,
    validationLevel,
    validationLevelReason,
    changedFiles,
    policy,
    validated: false,
    validationStatus: "not_run",
    message: "Validation status: NOT RUN. No validation checks were detected or executed. This is not a passed validation. Define a check/test/build script or pass an explicit check."
  };
  const stopOnFailure = args.stopOnFailure !== false;
  const fullOutput = Boolean(args.fullOutput);
  const runConfig = fullOutput
    ? { ...config, maxOutputBytes: Math.max(Number(config.maxOutputBytes) || 0, 16 * 1024 * 1024) }
    : config;
  const tailChars = fullOutput ? CHECK_OUTPUT_TAIL_FULL : CHECK_OUTPUT_TAIL_DEFAULT;
  const results = [];
  for (const command of checks) {
    const result = await runProcess(command, [], {
      cwd: workspace.path,
      shell: true,
      commandString: command,
      timeout: clampNumber(args.timeoutMs, 1000, 24 * 60 * 60 * 1000, 120000)
    }, runConfig);
    const summary = boundCheckOutput({ command, ...summarizeCommand(result) }, tailChars);
    results.push(summary);
    if (!summary.ok && stopOnFailure) break;
  }
  return { ok: results.every((item) => item.ok), workspace: workspace.alias, level, checks, commands: checks, results, aliasNormalizations, validationLevel, validationLevelReason, changedFiles, policy, ...(fullOutput ? { fullOutput: true } : {}) };
}

// Keep the last maxChars of a command stream so the failing tail survives the
// server-level result cap. Prepends a marker noting how much was dropped.
function tailString(text, maxChars) {
  const value = String(text);
  if (value.length <= maxChars) return value;
  return `[rel-ai-mcp kept last ${maxChars} of ${value.length} chars]\n` + value.slice(value.length - maxChars);
}

function boundCheckOutput(summary, maxChars) {
  const bounded = { ...summary };
  if (typeof bounded.stdout === "string") bounded.stdout = tailString(bounded.stdout, maxChars);
  if (typeof bounded.stderr === "string") bounded.stderr = tailString(bounded.stderr, maxChars);
  return bounded;
}

const SAFE_BROWSER_CHECK_NAME = /^[A-Za-z0-9:._-]+$/;

function readPackageScripts(root) {
  const packageJson = path.join(root, "package.json");
  if (!fs.existsSync(packageJson)) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJson, "utf8"));
    return pkg && pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  } catch (_error) {
    return {};
  }
}

function parseBrowserProbe(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  const lastLine = text.split(/\r?\n/).filter(Boolean).pop();
  if (!lastLine) return null;
  try {
    const probe = JSON.parse(lastLine);
    if (probe && typeof probe === "object") return probe;
  } catch (_error) {}
  return null;
}

function resolveBrowserTarget(rawUrl) {
  const text = String(rawUrl || "").trim();
  if (!text || /^https?:\/\//i.test(text)) return text;
  if (!text.startsWith("/")) return text;
  let host = "127.0.0.1";
  let port = Number(process.env.REL_AI_MCP_PORT || 3333);
  try {
    const connection = require("./connectionProfile");
    const profile = connection.readConnectionProfile();
    host = profile.host || host;
    port = Number(profile.port || port || 3333);
  } catch (_error) {}
  return new URL(text, `http://${host}:${port || 3333}`).toString();
}

async function relaiBrowser(workspace, config, args = {}) {
  const requestedUrl = String(args.url || args.route || "").trim();
  const command = String(args.command || "").trim();
  if (command) {
    // Bounded: only named package.json scripts may run, invoked as `npm run <name>`.
    // No arbitrary shell — keeps this a validation bridge, not a command runner.
    const scripts = readPackageScripts(workspace.path);
    const available = Object.keys(scripts).sort();
    if (!SAFE_BROWSER_CHECK_NAME.test(command) || !Object.prototype.hasOwnProperty.call(scripts, command)) {
      return {
        ok: false,
        workspace: workspace.alias,
        mode: "check",
        check: command,
        error: `Unknown check '${command}'. relai_browser runs named package.json scripts only. Available: ${available.join(", ") || "(none)"}.`,
        availableChecks: available
      };
    }
    // command passed SAFE_BROWSER_CHECK_NAME above (no spaces/metacharacters), so it
    // is safe to run through a shell. shell:true is required on Windows, where Node
    // refuses to spawn npm.cmd directly (EINVAL) since 18.20/20.12.
    const npmCommand = `npm run ${command}`;
    const result = await runProcess(npmCommand, [], {
      cwd: workspace.path,
      shell: true,
      commandString: npmCommand,
      timeout: clampNumber(args.timeoutMs, 1000, 24 * 60 * 60 * 1000, 120000)
    }, config);
    return { ok: result.exitCode === 0, workspace: workspace.alias, mode: "check", check: command, ...summarizeCommand(result) };
  }
  if (!requestedUrl) throw new Error("url, route, or check is required.");
  const url = resolveBrowserTarget(requestedUrl);
  const script = `
    const target = ${JSON.stringify(url)};
    fetch(target).then(async (res) => {
      const text = await res.text();
      console.log(JSON.stringify({ ok: res.ok, status: res.status, url: res.url, bytes: text.length, title: ((text.match(/<title[^>]*>([^<]*)<\\/title>/i)||[])[1] || '') }));
      process.exit(res.ok ? 0 : 1);
    }).catch((err) => { console.error(err && err.message || String(err)); process.exit(1); });
  `;
  const result = await runProcess(process.execPath, ["-e", script], { cwd: workspace.path, timeout: clampNumber(args.timeoutMs, 1000, 600000, 30000) }, config);
  const probe = parseBrowserProbe(result.stdout);
  return {
    workspace: workspace.alias,
    mode: "http",
    url,
    ...(requestedUrl !== url ? { requestedUrl } : {}),
    ...(probe ? {
      reachable: true,
      httpStatus: typeof probe.status === "number" ? probe.status : null,
      finalUrl: probe.url || url,
      responseBytes: typeof probe.bytes === "number" ? probe.bytes : null,
      title: probe.title || ""
    } : { reachable: false }),
    ...summarizeCommand(result),
    // Require an actual successful probe — never report ok:true for an
    // unreachable host (no probe) or a non-2xx response (probe.ok === false).
    ok: result.exitCode === 0 && !!probe && probe.ok !== false
  };
}

async function relaiDiff(workspace, config, args = {}) {
  const staged = Boolean(args.staged);
  const stat = await runProcess("git", ["status", "--short", "--branch"], { cwd: workspace.path, timeout: 30000 }, config);
  const diffArgs = ["diff", ...(staged ? ["--staged"] : [])];
  const filterPath = args.path ? resolveSafePath(workspace.path, args.path).relativePath : null;
  if (filterPath) diffArgs.push("--", filterPath);
  const diff = await runProcess("git", diffArgs, { cwd: workspace.path, timeout: 60000 }, config);
  const maxBytes = clampNumber(args.maxBytes, 1000, 5 * 1024 * 1024, DEFAULT_MAX_DIFF_BYTES);
  const diffText = diff.stdout || "";
  const ownership = classifyStatusOwnership(workspace, config, stat.stdout || "");
  return {
    ok: stat.exitCode === 0 && diff.exitCode === 0,
    workspace: workspace.alias,
    staged,
    ...(filterPath ? { path: filterPath } : {}),
    status: stat.stdout || "",
    branch: ownership.branch,
    aheadBehind: ownership.aheadBehind,
    statusEntries: ownership.entries,
    sessionChangedFiles: ownership.sessionChanged,
    baselineChangedFiles: ownership.baselineChanged,
    untrackedSessionFiles: ownership.untrackedSession,
    untrackedBaselineFiles: ownership.untrackedBaseline,
    ...(ownership.baselineSource ? { baselineSource: ownership.baselineSource } : {}),
    diff: Buffer.byteLength(diffText, "utf8") > maxBytes ? diffText.slice(0, maxBytes) + `\n[rel-ai-mcp diff truncated at ${maxBytes} bytes]` : diffText,
    exitCode: diff.exitCode,
    ...(diff.stderr ? { stderr: diff.stderr } : {})
  };
}

async function relaiReset(workspace, config, args = {}) {
  const mode = String(args.mode || "paths").toLowerCase();
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (paths.length > 0) {
    const safePaths = paths.map((p) => resolveSafePath(workspace.path, p).relativePath);
    const restore = await runProcess("git", ["restore", "--", ...safePaths], { cwd: workspace.path, timeout: 60000 }, config);
    // git restore only knows TRACKED paths, so an untracked disposable file makes it
    // exit non-zero with a pathspec error. With clean:true, also remove untracked
    // matches via git clean and treat that restore pathspec-miss as non-fatal — so
    // clean:true + paths can revert tracked edits AND delete untracked files.
    let clean = null;
    if (args.clean) clean = await runProcess("git", ["clean", "-fd", "--", ...safePaths], { cwd: workspace.path, timeout: 60000 }, config);
    const restorePathspecMiss = restore.exitCode !== 0 && /did not match any file|pathspec/i.test(restore.stderr || "");
    const restoreOk = restore.exitCode === 0 || (Boolean(args.clean) && restorePathspecMiss);
    const cleanOk = !clean || clean.exitCode === 0;
    // ok is computed last so the spread summarizeCommand(restore).ok (which reflects
    // only the restore step) cannot override the combined restore+clean result.
    return { workspace: workspace.alias, mode: "paths", paths: safePaths, ...summarizeCommand(restore), ...(clean ? { clean: summarizeCommand(clean) } : {}), ok: restoreOk && cleanOk };
  }
  if (mode !== "hard") throw new Error("relai_restore_changes requires paths, or mode='hard'.");
  const reset = await runProcess("git", ["reset", "--hard"], { cwd: workspace.path, timeout: 60000 }, config);
  let clean = null;
  if (args.clean) clean = await runProcess("git", ["clean", "-fd"], { cwd: workspace.path, timeout: 60000 }, config);
  return { ok: reset.exitCode === 0 && (!clean || clean.exitCode === 0), workspace: workspace.alias, mode: "hard", reset: summarizeCommand(reset), ...(clean ? { clean: summarizeCommand(clean) } : {}) };
}

async function relaiRemoveFile(workspace, config, args = {}) {
  const relativePath = String(args.path || "").trim();
  if (!relativePath) throw new Error("relai_remove_file requires path.");
  const reason = String(args.reason || "").trim();
  let result;
  try {
    result = relaiClear(workspace, config, { path: relativePath, expectedSha256: args.expectedSha256, dryRun: args.dryRun, failIfMissing: args.failIfMissing });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(/relai_clear_files/g, "relai_remove_file"), { cause: error });
  }
  if (!args.dryRun && args.stage === true && result.changedFiles.length > 0) {
    const stage = await runProcess("git", ["add", "--", ...result.changedFiles], { cwd: workspace.path, timeout: 60000 }, config);
    return { ...result, reason, stage: summarizeCommand(stage), ok: result.ok && stage.exitCode === 0 };
  }
  return { ...result, reason };
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
    } catch (_error) {}
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
  const flow = workflowSummary(config);
  return {
    flow,
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
      "apply-bundle": {
        tool: "relai_apply_bundle",
        when: [
          "a prepared file bundle already exists on the MCP host",
          "many files need to be overlaid together"
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
      "Use apply-bundle when a prepared archive should overlay many files.",
      "Use workspace-tidy plan/run for generated session artifacts."
    ],
    examples: {
      exactReplace: "relai_replace { workspace, path, expectedSha256, oldText, newText }",
      directWrite: "relai_write { workspace, path, content }",
      stagedWriteStart: "relai_write { workspace, stage: 'start', path, content }",
      stagedWriteAppend: "relai_write { workspace, stage: 'append', writeId, content }",
      stagedWriteCommit: "relai_write { workspace, stage: 'commit', writeId }",
      applyUpdate: "relai_edit { workspace, updateText, runChecks: true, returnDiff: true }",
      applyBundle: "relai_apply_bundle { workspace, bundlePath, checks }",
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
      next: "Prefer relai_replace with exact current text. Use staged relai_write for unavoidable whole-file replacement. Use relai_clear_files only for obsolete files."
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
  } else if (Object.prototype.hasOwnProperty.call(args, "oldText") || Object.prototype.hasOwnProperty.call(args, "newText")) {
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

function hasRequestedChecks(args = {}) {
  return Boolean(args.verify || args.check || args.checks || args.checksText || args.command || args.commands || args.commandsText);
}


function normalizeVerifyChecks(args, root, level) {
  const discovered = discoverCommands(root);
  const explicit = [];
  let aliasNormalizations = 0;

  function resolveAndTrack(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return trimmed;
    const { command, normalized } = normalizeCommandAlias(trimmed, trimmed, discovered);
    if (normalized) aliasNormalizations++;
    return command;
  }

  if (typeof args.check === "string" && args.check.trim()) explicit.push(resolveAndTrack(args.check));
  if (typeof args.command === "string" && args.command.trim()) explicit.push(resolveAndTrack(args.command));
  if (Array.isArray(args.commands)) {
    for (const item of args.commands) {
      const command = resolveAndTrack(String(item || ""));
      if (command) explicit.push(command);
    }
  }
  if (typeof args.commandsText === "string" && args.commandsText.trim()) {
    for (const line of args.commandsText.split(/\r?\n/)) {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith("#")) {
        explicit.push(resolveAndTrack(trimmedLine));
      }
    }
  }
  if (explicit.length) return { checks: [...new Set(explicit)], aliasNormalizations };
  return { checks: detectVerifyChecks(root, level), aliasNormalizations };
}

function detectVerifyChecks(root, level) {
  const commands = [];
  const packageJson = path.join(root, "package.json");
  if (fs.existsSync(packageJson)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJson, "utf8"));
      const scripts = pkg.scripts || {};
      if (level === "release" && scripts["test:all"]) {
        commands.push("npm run test:all");
      } else {
        if (scripts.check) {
          commands.push("npm run check");
        } else if (level === "quick" && fs.existsSync(path.join(root, "src", "tools.js"))) {
          commands.push("node --check src/tools.js");
        }
        if (level !== "quick" && scripts.test) commands.push("npm test");
        if (scripts.build && shouldRunPackageBuild(root, pkg, scripts, level, commands)) commands.push("npm run build");
      }
    } catch (_error) {
      if (level === "quick" && fs.existsSync(path.join(root, "src", "tools.js"))) commands.push("node --check src/tools.js");
    }
  }
  if (fs.existsSync(path.join(root, "pubspec.yaml"))) {
    if (level === "quick") {
      commands.push("dart analyze");
    } else {
      commands.push("flutter analyze");
      commands.push("flutter test");
    }
  }
  if (fs.existsSync(path.join(root, "pyproject.toml")) || fs.existsSync(path.join(root, "requirements.txt"))) commands.push("python -m pytest");
  if (fs.existsSync(path.join(root, "go.mod"))) commands.push("go test ./...");
  if (fs.existsSync(path.join(root, "Cargo.toml"))) commands.push("cargo test");
  return [...new Set(commands)];
}

function shouldRunPackageBuild(root, pkg, scripts, level, currentCommands) {
  if (level === "quick") return false;
  if (level === "full" || level === "release") return true;
  if (!currentCommands || currentCommands.length === 0) return true;
  const allDeps = {
    ...(pkg && pkg.dependencies && typeof pkg.dependencies === "object" ? pkg.dependencies : {}),
    ...(pkg && pkg.devDependencies && typeof pkg.devDependencies === "object" ? pkg.devDependencies : {})
  };
  const dependencyNames = new Set(Object.keys(allDeps));
  const buildCriticalDeps = ["next", "vite", "nuxt", "astro", "@remix-run/dev", "@sveltejs/kit", "react-scripts", "webpack", "parcel"];
  if (buildCriticalDeps.some((name) => dependencyNames.has(name))) return true;
  const build = String((scripts && scripts.build) || "");
  if (/\b(next|vite|nuxt|astro|remix|svelte-kit|react-scripts|webpack|parcel)\b/i.test(build)) return true;
  if (fs.existsSync(path.join(root, "next.config.js")) || fs.existsSync(path.join(root, "next.config.mjs"))) return true;
  return false;
}


function sha256Text(text) {
  return require("node:crypto").createHash("sha256").update(String(text), "utf8").digest("hex");
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

module.exports = {
  repoSnapshot,
  relaiRead,
  relaiWrite,
  relaiReplace,
  relaiClear,
  relaiApplyPatch,
  relaiApplyArchive,
  relaiSnapshotArchive,
  relaiVerify,
  relaiBrowser,
  relaiDiff,
  relaiReset,
  relaiGitStatus,
  relaiGitFetch,
  relaiGitCommit,
  relaiGitPush,
  relaiGitMergeBranch,
  relaiGitMergeRemoteBranchesPlan,
  relaiGitAbortMerge,
  relaiGitCreatePr,
  relaiRemoveFile,
  relaiRefactorAudit,
  normalizeOpenAIPatchFormat,
  classifyStatusOwnership,
  buildZipCommand,
  buildUnzipCommand,
  copyWorkspaceForArchive,
  overlayDirectory,
  shouldSkipArchivePath,
  STAGED_WRITE_BYTE_THRESHOLD,
  STAGED_WRITE_LINE_THRESHOLD,
  writeStagedPayload,
  readStagedPayload,
  clearStagedPayload,
  resolveStagedWriteId,
  workspaceTidyPlan,
  workspaceTidyRun: relaiWorkspaceTidyRun
};
