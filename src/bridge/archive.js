const fs = require("node:fs");
const path = require("node:path");
const { appendOperation, makeOperationId } = require("../journal");
const {
  preparedFlag, assertPreparedBundleSafe, ensureGitRepo, requireCleanGitIfConfigured,
  shouldMakePreparedBackup, makePreparedBackup, tempStateDir
} = require("../repo/gitOps");
const {
  resolveHostPath, extractZipArchive, createZipArchive, detectArchiveOverlayRoot,
  previewArchiveOverlay, overlayDirectory, copyWorkspaceForArchive
} = require("../repo/archiveUtils");
const { clampNumber } = require("./limits");
const { relaiVerify, hasRequestedChecks } = require("./validation");
const { relaiDiff } = require("./review");

const DEFAULT_MAX_DIFF_BYTES = 1024 * 1024;

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

module.exports = { relaiApplyArchive, relaiSnapshotArchive };
