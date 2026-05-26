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
const { appendOperation, makeOperationId, summarizeOperations } = require("./journal");
const { normalizeCommandAlias } = require("./commandNormalizer");
const { selectValidationLevel } = require("./validationStrategy");
const { resolvePolicy } = require("./policyResolver");

const DEFAULT_MAX_READ_BYTES = 1024 * 1024;
const DEFAULT_MAX_SNAPSHOT_FILES = 1000;
const DEFAULT_MAX_DIFF_BYTES = 300000;
const DEFAULT_STAGED_CHUNK_BYTES = 12000;
const STAGED_WRITE_BYTE_THRESHOLD = 8000;
const STAGED_WRITE_LINE_THRESHOLD = 180;
const EXACT_REPLACE_TEXT_BYTE_LIMIT = 50000;
const EXACT_REPLACE_MAX_OPERATIONS = 50;
const DEFAULT_AGGRESSIVE_MAX_PATCH_BYTES = 2 * 1024 * 1024;
const DEFAULT_AGGRESSIVE_MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const AGGRESSIVE_ARCHIVE_EXCLUDED_NAMES = new Set([".git", "node_modules", "build", "dist", "coverage", ".dart_tool", ".gradle", ".relai", ".rel-ai-mcp", ".venv", "venv", "target", "bin", "obj", "Pods"]);
const AGGRESSIVE_ARCHIVE_EXCLUDED_PATHS = [".git/", "node_modules/", "build/", "dist/", "coverage/", ".dart_tool/", ".gradle/", ".relai/", ".rel-ai-mcp/"];
const SOURCE_LIKE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.dart', '.py', '.go', '.rs', '.java', '.kt', '.swift', '.cs', '.cpp', '.c', '.h', '.hpp', '.rb', '.php', '.css', '.scss', '.html', '.xml', '.yaml', '.yml', '.json', '.md']);

function repoSnapshot(workspace, config, args = {}) {
  const maxEntries = clampNumber(args.maxEntries, 1, 20000, DEFAULT_MAX_SNAPSHOT_FILES);
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
    ...(includeFiles ? { files: tree.files } : {}),
    skipped: tree.skipped.slice(0, 200),
    truncated: tree.truncated,
    hints: projectHints(Object.keys(manifests)),
    recommendedFlow: recommendedFlowForConfig(config),
    writeGuidance: workspaceWriteGuidance(config),
    operationJournal: summarizeOperations(config, workspace, args.journalLimit || 10)
  };
}

function relaiRead(workspace, args = {}) {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (paths.length === 0) throw new Error("paths must contain at least one path.");
  const maxBytes = clampNumber(args.maxBytes, 1000, 10 * 1024 * 1024, DEFAULT_MAX_READ_BYTES);
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
      const data = fs.readFileSync(safe.absolutePath);
      if (looksBinary(data)) {
        skipped.push({ path: safe.relativePath, reason: "binary-looking file" });
        continue;
      }
      const text = data.toString("utf8");
      const truncated = Buffer.byteLength(text, "utf8") > maxBytes;
      items.push({
        type: "file",
        path: safe.relativePath,
        sha256: fileSha256(workspace.path, safe.relativePath),
        bytes: data.length,
        lineCount: countLines(text),
        truncated,
        writeGuidance: fileWriteGuidance(safe.relativePath, text),
        content: truncated ? text.slice(0, maxBytes) : text
      });
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
    const writeId = validateWriteId(args.writeId);
    if (typeof args.content !== "string") throw new Error("relai_write stage='append' requires writeId and a content chunk string.");
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
    const writeId = validateWriteId(args.writeId);
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
    return { ok: true, workspace: workspace.alias, operation: "stagedFullFileWrite:abort", writeId, cleared: existed, cleard: existed };
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
  const shaMismatch = Boolean(expectedSha256 && oldSha256 !== expectedSha256);

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
    const item = { path: safe.relativePath, cleared: !dryRun, cleard: !dryRun, dryRun, oldSha256, ...(shaMismatch ? { shaMismatch: { expectedSha256, currentSha256: oldSha256 } } : {}) };
    if (!dryRun) fs.rmSync(safe.absolutePath, { force: true });
    cleared.push(safe.relativePath);
    results.push(item);
  }

  appendOperation(config, workspace, {
    id: operationId,
    type: dryRun ? "clear:dryRun" : "clear",
    ok: true,
    paths: dryRun ? [] : cleared,
    results
  });

  return {
    ok: true,
    dryRun,
    workspace: workspace.alias,
    operationId,
    operation: "clearFiles",
    changed: !dryRun && cleared.length > 0,
    changedFiles: dryRun ? [] : cleared,
    cleared,
    cleard: cleared,
    skipped,
    results
  };
}


async function relaiApplyPatch(workspace, config, args = {}) {
  const patch = String(args.patch || args.diff || "");
  assertPreparedUpdateSafe(workspace, config, args, patch);
  const patchBytes = Buffer.byteLength(patch, "utf8");
  await ensureGitRepo(workspace, config);
  const touchedPaths = validatePatchPaths(workspace, patch);
  await requireCleanGitIfConfigured(workspace, config, args);
  const operationId = makeOperationId();
  const patchFile = tempStatePath(config, workspace, operationId, ".patch");
  fs.writeFileSync(patchFile, patch, "utf8");
  const check = await runProcess("git", ["apply", "--check", patchFile], { cwd: workspace.path, timeout: clampNumber(args.timeoutMs, 1000, 86400000, 120000) }, config);
  if (check.exitCode !== 0) {
    return { ok: false, workspace: workspace.alias, operationId, operation: "applyPatch:check", touchedPaths, check: summarizeCommand(check) };
  }
  let backup = null;
  if (shouldMakePreparedBackup(config, args)) backup = await makePreparedBackup(workspace, config, operationId, "patch");
  const apply = await runProcess("git", ["apply", patchFile], { cwd: workspace.path, timeout: clampNumber(args.timeoutMs, 1000, 86400000, 120000) }, config);
  const verify = hasRequestedChecks(args) ? await relaiVerify(workspace, config, args) : null;
  const diff = args.returnDiff === false ? null : await relaiDiff(workspace, config, { maxBytes: args.maxDiffBytes || DEFAULT_MAX_DIFF_BYTES });
  const ok = apply.exitCode === 0 && (!verify || verify.ok);
  appendOperation(config, workspace, { id: operationId, type: "apply_patch", ok, paths: touchedPaths, results: [{ operation: "applyPatch", bytes: patchBytes, touchedPaths, verified: verify ? verify.ok : null }] });
  return { ok, workspace: workspace.alias, operationId, operation: "applyPatch", changedFiles: apply.exitCode === 0 ? touchedPaths : [], touchedPaths, patchBytes, backup, apply: summarizeCommand(apply), ...(verify ? { verify } : {}), ...(diff ? { diff } : {}) };
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
  let backup = null;
  if (shouldMakePreparedBackup(config, args)) backup = await makePreparedBackup(workspace, config, operationId, "archive");
  const overlay = overlayDirectory(workspace.path, overlayRoot, { clearMissing: Boolean(args.clearMissing ?? preparedFlag(config, "clearMissingDefault", false)) });
  const verify = hasRequestedChecks(args) ? await relaiVerify(workspace, config, args) : null;
  const diff = args.returnDiff === false ? null : await relaiDiff(workspace, config, { maxBytes: args.maxDiffBytes || DEFAULT_MAX_DIFF_BYTES });
  const ok = overlay.errors.length === 0 && (!verify || verify.ok);
  appendOperation(config, workspace, { id: operationId, type: "apply_archive", ok, paths: overlay.changedFiles, results: [{ operation: "applyArchive", archivePath, copied: overlay.copied.length, cleared: overlay.cleared.length, cleard: overlay.cleared.length, skipped: overlay.skipped.length, verified: verify ? verify.ok : null }] });
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
  return { ok, workspace: workspace.alias, operationId, operation: "snapshotArchive", archivePath, copied, zip: zipped, bytes: fs.existsSync(archivePath) ? fs.statSync(archivePath).size : 0, note: "Archive is stored on the MCP host. Use relai_apply_bundle with bundlePath to overlay it onto a workspace, or retrieve it from this local path." };
}

function assertDirectWriteAllowed(_relativePath, _content) {
  return;
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
  return path.join(config.stateDir || path.join(process.cwd(), ".rel-ai-mcp-state"), "write-staging", safeAlias);
}

function stagedPath(config, workspace, writeId) {
  return path.join(stagedDir(config, workspace), `${validateWriteId(writeId)}.json`);
}

function validateWriteId(writeId) {
  const text = String(writeId || "").trim();
  if (!/^op_[a-z0-9]+_[a-f0-9]{12}$/.test(text)) throw new Error("Invalid or missing relai_write writeId.");
  return text;
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
  if (checks.length === 0) return { ok: true, workspace: workspace.alias, level, checks: [], commands: [], results: [], aliasNormalizations: 0, validationLevel, validationLevelReason, changedFiles, policy, message: "No validation checks detected." };
  const stopOnFailure = args.stopOnFailure !== false;
  const results = [];
  for (const command of checks) {
    const result = await runProcess(command, [], {
      cwd: workspace.path,
      shell: true,
      commandString: command,
      timeout: clampNumber(args.timeoutMs, 1000, 24 * 60 * 60 * 1000, 120000)
    }, config);
    const summary = { command, ...summarizeCommand(result) };
    results.push(summary);
    if (!summary.ok && stopOnFailure) break;
  }
  return { ok: results.every((item) => item.ok), workspace: workspace.alias, level, checks, commands: checks, results, aliasNormalizations, validationLevel, validationLevelReason, changedFiles, policy };
}

async function relaiBrowser(workspace, config, args = {}) {
  const url = String(args.url || args.route || "").trim();
  const command = String(args.command || "").trim();
  if (command) {
    const result = await runProcess(command, [], {
      cwd: workspace.path,
      shell: true,
      commandString: command,
      timeout: clampNumber(args.timeoutMs, 1000, 24 * 60 * 60 * 1000, 120000)
    }, config);
    return { ok: result.exitCode === 0, workspace: workspace.alias, mode: "command", command, ...summarizeCommand(result) };
  }
  if (!url) throw new Error("url, route, or command is required.");
  const script = `
    const target = ${JSON.stringify(url)};
    fetch(target).then(async (res) => {
      const text = await res.text();
      console.log(JSON.stringify({ ok: res.ok, status: res.status, url: res.url, bytes: text.length, title: ((text.match(/<title[^>]*>([^<]*)<\\/title>/i)||[])[1] || '') }));
      process.exit(res.ok ? 0 : 1);
    }).catch((err) => { console.error(err && err.message || String(err)); process.exit(1); });
  `;
  const result = await runProcess(process.execPath, ["-e", script], { cwd: workspace.path, timeout: clampNumber(args.timeoutMs, 1000, 600000, 30000) }, config);
  return { ok: result.exitCode === 0, workspace: workspace.alias, mode: "http", url, ...summarizeCommand(result) };
}

async function relaiDiff(workspace, config, args = {}) {
  const staged = Boolean(args.staged);
  const stat = await runProcess("git", ["status", "--short"], { cwd: workspace.path, timeout: 30000 }, config);
  const diffArgs = ["diff", ...(staged ? ["--staged"] : [])];
  if (args.path) diffArgs.push("--", resolveSafePath(workspace.path, args.path).relativePath);
  const diff = await runProcess("git", diffArgs, { cwd: workspace.path, timeout: 60000 }, config);
  const maxBytes = clampNumber(args.maxBytes, 1000, 5 * 1024 * 1024, DEFAULT_MAX_DIFF_BYTES);
  const diffText = diff.stdout || "";
  return {
    ok: stat.exitCode === 0 && diff.exitCode === 0,
    workspace: workspace.alias,
    staged,
    status: stat.stdout || "",
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
    return { ok: restore.exitCode === 0, workspace: workspace.alias, mode: "paths", paths: safePaths, ...summarizeCommand(restore) };
  }
  if (mode !== "hard") throw new Error("relai_restore_changes requires paths, or mode='hard'.");
  const reset = await runProcess("git", ["reset", "--hard"], { cwd: workspace.path, timeout: 60000 }, config);
  let clean = null;
  if (args.clean) clean = await runProcess("git", ["clean", "-fd"], { cwd: workspace.path, timeout: 60000 }, config);
  return { ok: reset.exitCode === 0 && (!clean || clean.exitCode === 0), workspace: workspace.alias, mode: "hard", reset: summarizeCommand(reset), ...(clean ? { clean: summarizeCommand(clean) } : {}) };
}


function getPreparedConfig(config) {
  const wf = config.workflow && typeof config.workflow === "object" ? config.workflow : {};
  return wf.prepared && typeof wf.prepared === "object" ? wf.prepared : {};
}

function preparedNumber(config, key, fallback) {
  const value = getPreparedConfig(config)[key];
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function preparedFlag(config, key, fallback) {
  const value = getPreparedConfig(config)[key];
  return value == null ? fallback : Boolean(value);
}

function workflowSummary(config) {
  const { isPreparedWorkflow, getWorkflowConfig } = require("./config");
  const wf = getWorkflowConfig(config);
  return {
    mode: wf.mode,
    prepared: {
      requireCleanGit: preparedFlag(config, "requireCleanGit", true),
      backup: preparedFlag(config, "backup", true),
      clearMissingDefault: preparedFlag(config, "clearMissingDefault", false),
      maxUpdateBytes: preparedNumber(config, "maxUpdateBytes", DEFAULT_AGGRESSIVE_MAX_PATCH_BYTES),
      maxBundleBytes: preparedNumber(config, "maxBundleBytes", DEFAULT_AGGRESSIVE_MAX_ARCHIVE_BYTES)
    }
  };
}

function recommendedFlowForConfig(config) {
  const { isPreparedWorkflow } = require("./config");
  const base = ["relai_read", "relai_replace", "relai_write", "relai_clear_files", "relai_run_checks", "relai_diff", "relai_restore_changes"];
  if (!isPreparedWorkflow(config)) return base;
  return ["relai_repo_snapshot", "relai_read", "relai_replace", "relai_apply_update", "relai_apply_bundle", "relai_package_snapshot", "relai_clear_files", "relai_run_checks", "relai_diff", "relai_restore_changes"];
}

function assertPreparedUpdateSafe(workspace, config, args, patch) {
  // payload exists
  if (!patch || !patch.trim()) throw new Error("relai_apply_update requires patch or diff text.");
  // payload size
  const maxBytes = preparedNumber(config, "maxUpdateBytes", DEFAULT_AGGRESSIVE_MAX_PATCH_BYTES);
  const bytes = Buffer.byteLength(patch, "utf8");
  if (bytes > maxBytes) throw new Error(`relai_apply_update refused ${bytes} byte patch; max is ${maxBytes}.`);
  // valid workspace (already resolved before this call, but verify)
  if (!workspace || !workspace.path) throw new Error("relai_apply_update requires a valid workspace.");
}

function assertPreparedBundleSafe(workspace, config, args, archivePath, stat) {
  // payload exists
  if (!archivePath) throw new Error("relai_apply_bundle requires bundlePath pointing to a local zip archive on the MCP host.");
  if (!stat || !stat.isFile()) throw new Error(`Archive path is not a file: ${archivePath}`);
  // payload size
  const maxBytes = preparedNumber(config, "maxBundleBytes", DEFAULT_AGGRESSIVE_MAX_ARCHIVE_BYTES);
  if (stat.size > maxBytes) throw new Error(`relai_apply_bundle refused ${stat.size} byte archive; max is ${maxBytes}.`);
  // valid workspace
  if (!workspace || !workspace.path) throw new Error("relai_apply_bundle requires a valid workspace.");
  // no workspace escape (archive path must not be inside the workspace itself for safety)
  // archive is on MCP host, not workspace — no further check needed here
}

async function ensureGitRepo(workspace, config) {
  const result = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], { cwd: workspace.path, timeout: 30000 }, config);
  if (result.exitCode !== 0 || !String(result.stdout || "").trim().startsWith("true")) throw new Error(`Workspace '${workspace.alias}' is not a git work tree.`);
}

async function gitStatusShort(workspace, config) {
  const result = await runProcess("git", ["status", "--short"], { cwd: workspace.path, timeout: 30000 }, config);
  if (result.exitCode !== 0) throw new Error(`git status failed for ${workspace.alias}: ${result.stderr || result.stdout || result.exitCode}`);
  return String(result.stdout || "");
}

async function requireCleanGitIfConfigured(workspace, config, args) {
  if (args.requireCleanGit !== true) return;
  const status = await gitStatusShort(workspace, config);
  if (status.trim()) throw new Error(`Workspace '${workspace.alias}' is not clean.
${status}`);
}

function shouldMakePreparedBackup(config, args) {
  return args.backup == null ? preparedFlag(config, "backup", true) : Boolean(args.backup);
}

async function makePreparedBackup(workspace, config, operationId, label) {
  const status = await gitStatusShort(workspace, config);
  if (!status.trim()) return { type: "none", reason: "workspace clean" };
  const message = `rel-ai-mcp prepared ${label} backup ${operationId}`;
  const stash = await runProcess("git", ["stash", "push", "--include-untracked", "-m", message], { cwd: workspace.path, timeout: 120000 }, config);
  return { type: "git-stash", message, ok: stash.exitCode === 0, ...summarizeCommand(stash) };
}

function tempStateDir(config, workspace, operationId, prefix) {
  const safeAlias = String(workspace.alias || "workspace").replace(/[^A-Za-z0-9_.-]/g, "_");
  const base = path.join(config.stateDir || path.join(process.cwd(), ".rel-ai-mcp-state"), "fast", safeAlias);
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  return fs.mkdtempSync(path.join(base, `${prefix}-${operationId}-`));
}

function tempStatePath(config, workspace, operationId, ext) {
  const dir = tempStateDir(config, workspace, operationId, "payload");
  return path.join(dir, `payload${ext}`);
}

function validatePatchPaths(workspace, patch) {
  const paths = [];
  const seen = new Set();
  for (const line of String(patch || "").split(/\r?\n/)) {
    let value = null;
    if (line.startsWith("+++ b/")) value = line.slice(6);
    else if (line.startsWith("--- a/")) value = line.slice(6);
    else if (line.startsWith("rename from ")) value = line.slice("rename from ".length);
    else if (line.startsWith("rename to ")) value = line.slice("rename to ".length);
    if (!value || value === "/dev/null") continue;
    const safe = resolveSafePath(workspace.path, value);
    if (!seen.has(safe.relativePath)) {
      seen.add(safe.relativePath);
      paths.push(safe.relativePath);
    }
  }
  if (paths.length === 0) throw new Error("Patch did not contain any valid workspace file paths. Expected unified diff format with headers like '--- a/path/to/file' and '+++ b/path/to/file'. Example: use 'git diff' output or generate a patch with 'git format-patch'.");
  return paths;
}

function resolveHostPath(value) {
  if (!value) return "";
  let text = String(value).trim();
  if (text === "~") text = require("node:os").homedir();
  else if (text.startsWith("~/") || text.startsWith("~\\")) text = path.join(require("node:os").homedir(), text.slice(2));
  return path.resolve(text);
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildZipCommand(platform, sourceDir, archivePath) {
  if (platform === "win32") {
    return {
      exe: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        `Compress-Archive -Path ${quotePowerShell(path.join(sourceDir, "*"))} -DestinationPath ${quotePowerShell(archivePath)} -Force`]
    };
  }
  return { exe: "zip", args: ["-qr", archivePath, "."], cwd: sourceDir };
}

function buildUnzipCommand(platform, archivePath, destination) {
  if (platform === "win32") {
    return {
      exe: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(destination)} -Force`]
    };
  }
  return { exe: "unzip", args: ["-q", archivePath, "-d", destination] };
}

async function extractZipArchive(archivePath, destination, config, args) {
  const timeout = clampNumber(args.timeoutMs, 1000, 86400000, 120000);
  const cmd = buildUnzipCommand(process.platform, archivePath, destination);
  const result = await runProcess(cmd.exe, cmd.args, { cwd: cmd.cwd || destination, timeout }, config);
  return { ok: result.exitCode === 0, ...summarizeCommand(result) };
}

async function createZipArchive(sourceDir, archivePath, config, args) {
  const timeout = clampNumber(args.timeoutMs, 1000, 86400000, 120000);
  fs.mkdirSync(path.dirname(archivePath), { recursive: true, mode: 0o700 });
  const cmd = buildZipCommand(process.platform, sourceDir, archivePath);
  const result = await runProcess(cmd.exe, cmd.args, { cwd: cmd.cwd || sourceDir, timeout }, config);
  return { ok: result.exitCode === 0, ...summarizeCommand(result) };
}

function detectArchiveOverlayRoot(extractedRoot) {
  const entries = fs.readdirSync(extractedRoot, { withFileTypes: true }).filter((entry) => entry.name !== "__MACOSX");
  const dirs = entries.filter((entry) => entry.isDirectory());
  const files = entries.filter((entry) => entry.isFile());
  if (dirs.length === 1 && files.length === 0) return path.join(extractedRoot, dirs[0].name);
  return extractedRoot;
}

function overlayDirectory(workspaceRoot, sourceRoot, options = {}) {
  const copied = [];
  const cleared = [];
  const skipped = [];
  const errors = [];
  const sourceFiles = new Set();
  walkArchiveSource(sourceRoot, "", (absoluteSource, relativePath, stat) => {
    sourceFiles.add(relativePath);
    try {
      const safe = resolveSafePath(workspaceRoot, relativePath);
      fs.mkdirSync(path.dirname(safe.absolutePath), { recursive: true });
      fs.copyFileSync(absoluteSource, safe.absolutePath);
      copied.push({ path: safe.relativePath, bytes: stat.size });
    } catch (error) {
      errors.push({ path: relativePath, error: error instanceof Error ? error.message : String(error) });
    }
  }, skipped);

  if (options.clearMissing) {
    walkArchiveTarget(workspaceRoot, "", (absoluteTarget, relativePath) => {
      if (sourceFiles.has(relativePath)) return;
      try {
        const safe = resolveSafePath(workspaceRoot, relativePath);
        fs.rmSync(safe.absolutePath, { force: true });
        cleared.push(safe.relativePath);
      } catch (error) {
        errors.push({ path: relativePath, error: error instanceof Error ? error.message : String(error) });
      }
    }, skipped);
  }

  return { copied, cleared, cleard: cleared, skipped, errors, changedFiles: [...new Set([...copied.map((item) => item.path), ...cleared])] };
}

function walkArchiveSource(root, prefix, onFile, skipped) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, prefix), { withFileTypes: true }); } catch (error) { skipped.push({ path: prefix || ".", reason: error.message }); return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (shouldSkipArchivePath(rel, entry)) { skipped.push({ path: rel, reason: "excluded archive path" }); continue; }
    const abs = path.join(root, rel);
    if (entry.isSymbolicLink()) { skipped.push({ path: rel, reason: "symlink skipped" }); continue; }
    if (entry.isDirectory()) { walkArchiveSource(root, rel, onFile, skipped); continue; }
    if (!entry.isFile()) continue;
    onFile(abs, rel, fs.statSync(abs));
  }
}

function walkArchiveTarget(root, prefix, onFile, skipped) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, prefix), { withFileTypes: true }); } catch (error) { skipped.push({ path: prefix || ".", reason: error.message }); return; }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (shouldSkipArchivePath(rel, entry)) continue;
    const abs = path.join(root, rel);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { walkArchiveTarget(root, rel, onFile, skipped); continue; }
    if (entry.isFile()) onFile(abs, rel);
  }
}

function shouldSkipArchivePath(relativePath, entry) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (!normalized || normalized.includes("/../") || normalized.startsWith("../")) return true;
  if (AGGRESSIVE_ARCHIVE_EXCLUDED_NAMES.has(entry.name) || AGGRESSIVE_ARCHIVE_EXCLUDED_NAMES.has(normalized)) return true;
  for (const pattern of AGGRESSIVE_ARCHIVE_EXCLUDED_PATHS) {
    if (normalized === pattern.replace(/\/$/, "") || normalized.startsWith(pattern)) return true;
  }
  // Skip any .env* files (e.g. .env, .env.local, .env.production, .env-staging)
  if (/^\.env($|[./-])/i.test(entry.name)) return true;
  return false;
}

function copyWorkspaceForArchive(sourceRoot, destinationRoot, options = {}) {
  const files = [];
  const skipped = [];
  const maxFiles = options.maxFiles || 50000;
  walkArchiveSource(sourceRoot, "", (absoluteSource, relativePath, stat) => {
    if (files.length >= maxFiles) { skipped.push({ path: relativePath, reason: "maxFiles reached" }); return; }
    const out = path.join(destinationRoot, relativePath);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(absoluteSource, out);
    files.push({ path: relativePath, bytes: stat.size });
  }, skipped);
  return { files, skipped, truncated: files.length >= maxFiles };
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
        tool: "relai_apply_update",
        when: [
          "a multi-file change is already represented as a unified patch",
          "several related files need coordinated text edits"
        ]
      },
      "apply-bundle": {
        tool: "relai_apply_bundle",
        when: [
          "a prepared file bundle already exists on the MCP host",
          "many files need to be overlaid together"
        ]
      },
      "clear-file": {
        tool: "relai_clear_files",
        when: ["one or more obsolete files should be removed"]
      }
    },
    selectionOrder: [
      "Use exact-replace for small edits inside existing files.",
      "Use direct-write for complete replacement of small or normal-sized files.",
      "Use staged-write for complete replacement of large files.",
      "Use apply-update when the change is naturally patch-shaped across files.",
      "Use apply-bundle when a prepared archive should overlay many files.",
      "Use clear-file for obsolete files."
    ],
    examples: {
      exactReplace: "relai_replace { workspace, path, expectedSha256, oldText, newText }",
      directWrite: "relai_write { workspace, path, content }",
      stagedWriteStart: "relai_write { workspace, stage: 'start', path, content }",
      stagedWriteAppend: "relai_write { workspace, stage: 'append', writeId, content }",
      stagedWriteCommit: "relai_write { workspace, stage: 'commit', writeId }",
      applyUpdate: "relai_apply_update { workspace, updateText, checks }",
      applyBundle: "relai_apply_bundle { workspace, bundlePath, checks }",
      clearFile: "relai_clear_files { workspace, path }"
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
        tool: "relai_apply_update",
        reason: "Use a prepared update when the change is patch-shaped across multiple files."
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
      tool: "relai_apply_update",
      reason: "Use a prepared update when the change is patch-shaped across multiple files."
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

function resolveCommandAlias(raw, discoveredCommands) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return trimmed;
  if (discoveredCommands && Object.prototype.hasOwnProperty.call(discoveredCommands, trimmed)) {
    return discoveredCommands[trimmed];
  }
  return trimmed;
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
      if (scripts.check) {
        commands.push("npm run check");
      } else if (level === "quick" && fs.existsSync(path.join(root, "src", "tools.js"))) {
        commands.push("node --check src/tools.js");
      }
      if (level !== "quick" && scripts.test) commands.push("npm test");
      if (level === "full" && scripts.build) commands.push("npm run build");
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
  buildZipCommand,
  buildUnzipCommand,
  copyWorkspaceForArchive,
  overlayDirectory,
  shouldSkipArchivePath,
  STAGED_WRITE_BYTE_THRESHOLD,
  STAGED_WRITE_LINE_THRESHOLD
};
