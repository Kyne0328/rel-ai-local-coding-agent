'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  workspaceReplace,
  workspaceWrite,
  relaiApplyPatch,
  relaiVerify,
  relaiDiff,
  writeStagedPayload,
  readStagedPayload,
  clearStagedPayload,
  resolveStagedWriteId,
  STAGED_WRITE_BYTE_THRESHOLD,
  STAGED_WRITE_LINE_THRESHOLD
} = require('./localRepoBridge');
const { makeOperationId, appendOperation } = require('./journal');
const { resolveSafePath } = require('./safety');
const { runEnvOperation } = require('./envOperations');
const {
  MAX_BATCH_EDITS,
  MAX_BATCH_REPLACEMENTS,
  MAX_BATCH_INPUT_BYTES,
  MAX_BATCH_SNAPSHOT_BYTES,
  BATCH_RESULT_COMPACT_THRESHOLD
} = require('./editLimits');

const STAGED_CHUNK_BYTES = 12000;

async function runStagedWrite(workspace, config, path, content, dryRun, suppressJournal = false, expectedSha256 = '') {
  const chunks = [];
  let offset = 0;
  while (offset < content.length) {
    chunks.push(content.slice(offset, offset + STAGED_CHUNK_BYTES));
    offset += STAGED_CHUNK_BYTES;
  }
  const startResult = workspaceWrite(workspace, config, { stage: 'start', path, content: chunks[0], dryRun, suppressJournal, expectedSha256 });
  const { writeId } = startResult;
  for (let i = 1; i < chunks.length; i++) {
    workspaceWrite(workspace, config, { stage: 'append', writeId, content: chunks[i], suppressJournal });
  }
  return workspaceWrite(workspace, config, { stage: 'commit', writeId, dryRun, suppressJournal });
}

// Apply one logical edit: exact replacement when oldText is given, otherwise a
// full-file write (large content auto-routes to the staged chunked write).
async function applyOneEdit(workspace, config, edit, dryRun, options = {}) {
  const path = edit.path;
  const hasOldText = typeof edit.oldText === 'string' && edit.oldText.length > 0;
  const hasReplacements = Array.isArray(edit.replacements) && edit.replacements.length > 0;
  const hasReplacement = hasOldText || hasReplacements;
  const hasContent = typeof edit.content === 'string';

  if (hasOldText && hasReplacements) {
    throw new TypeError(`edit for ${path}: provide oldText+newText OR replacements:[...], not both`);
  }
  if (hasReplacement && hasContent) {
    throw new TypeError(`edit for ${path}: provide exact replacement input OR content, not both`);
  }
  if (!hasReplacement && !hasContent) {
    throw new TypeError(`edit for ${path}: must provide oldText+newText, replacements:[...], or content`);
  }

  if (hasReplacement) {
    if (hasOldText && typeof edit.newText !== 'string') {
      throw new TypeError(`edit for ${path}: newText is required (and must be a string) alongside oldText`);
    }
    const result = workspaceReplace(workspace, config, {
      path,
      oldText: edit.oldText,
      newText: edit.newText,
      occurrence: edit.occurrence,
      replacements: edit.replacements,
      expectedSha256: edit.expectedSha256,
      dryRun,
      suppressJournal: options.suppressJournal === true
    });
    return { ...result, path, plannerPath: 'replace' };
  }

  const contentBytes = Buffer.byteLength(edit.content, 'utf8');
  const lineCount = edit.content.split(/\r?\n/).length;
  if (contentBytes > STAGED_WRITE_BYTE_THRESHOLD || lineCount > STAGED_WRITE_LINE_THRESHOLD) {
    if (dryRun) {
      const result = workspaceWrite(workspace, config, { path, content: edit.content, expectedSha256: edit.expectedSha256, dryRun: true, suppressJournal: true });
      return { ...result, path, plannerPath: 'write:staged' };
    }
    const result = await runStagedWrite(workspace, config, path, edit.content, false, options.suppressJournal === true, edit.expectedSha256);
    return { ...result, path, plannerPath: 'write:staged' };
  }
  const result = workspaceWrite(workspace, config, { path, content: edit.content, expectedSha256: edit.expectedSha256, dryRun, suppressJournal: options.suppressJournal === true });
  return { ...result, path, plannerPath: 'write' };
}

function validateBatchEdits(workspace, edits) {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new TypeError('relai_edit edits must contain at least one structured edit.');
  }
  if (edits.length > MAX_BATCH_EDITS) {
    throw new Error(`relai_edit accepts at most ${MAX_BATCH_EDITS} structured batch edits. Use updateText or a staged patch for larger changes.`);
  }

  let serialized;
  try {
    serialized = JSON.stringify(edits);
  } catch (error) {
    throw new TypeError(
      `relai_edit could not serialize the structured batch: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  const inputBytes = Buffer.byteLength(serialized, 'utf8');
  if (inputBytes > MAX_BATCH_INPUT_BYTES) {
    throw new Error(`relai_edit structured batch input is ${inputBytes} bytes; max is ${MAX_BATCH_INPUT_BYTES}. Use updateText or a staged patch for larger payloads.`);
  }

  let replacementCount = 0;
  for (const edit of edits) {
    if (Array.isArray(edit?.replacements)) replacementCount += edit.replacements.length;
    else if (edit && (Object.hasOwn(edit, 'oldText') || Object.hasOwn(edit, 'newText'))) replacementCount += 1;
    if (replacementCount > MAX_BATCH_REPLACEMENTS) {
      throw new Error(`relai_edit structured batches accept at most ${MAX_BATCH_REPLACEMENTS} total replacement operations.`);
    }
  }

  const snapshotBytes = estimateBatchSnapshotBytes(workspace, edits);
  return { inputBytes, replacementCount, snapshotBytes };
}

function estimateBatchSnapshotBytes(workspace, edits) {
  const seen = new Set();
  let bytes = 0;
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object' || !edit.path) continue;
    let safe;
    try {
      safe = resolveSafePath(workspace.path, edit.path);
    } catch {
      continue;
    }
    if (seen.has(safe.relativePath)) continue;
    seen.add(safe.relativePath);
    let stat;
    try {
      stat = fs.statSync(safe.absolutePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    bytes += stat.size;
    if (bytes > MAX_BATCH_SNAPSHOT_BYTES) {
      throw new Error(`relai_edit rollback snapshots would require ${bytes} bytes; max is ${MAX_BATCH_SNAPSHOT_BYTES}. Split the batch or use updateText.`);
    }
  }
  return bytes;
}

async function preflightBatchEdits(workspace, config, edits, dryRun) {
  const results = [];
  let allOk = true;

  for (const edit of edits) {
    if (!edit || typeof edit !== 'object' || !edit.path) {
      results.push({ ok: false, error: 'each edit requires a path', preflight: true });
      allOk = false;
      continue;
    }
    try {
      const result = await applyOneEdit(workspace, config, edit, true, { suppressJournal: true });
      results.push({ ...result, preflight: true });
      if (result.ok === false) allOk = false;
    } catch (error) {
      results.push({ ok: false, path: edit.path, error: error instanceof Error ? error.message : String(error), preflight: true });
      allOk = false;
    }
  }

  return { ok: allOk, results, dryRun };
}

// Optional post-actions: validate and/or return a diff in the SAME call, so a
// change-verify-review loop costs one approval instead of three.
async function runPostActions(workspace, config, args) {
  const post = {};
  if (args.runChecks === true && !args.dryRun) {
    try {
      post.checks = await relaiVerify(workspace, config, { level: args.level });
    } catch (error) {
      post.checks = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (args.returnDiff === true) {
    try {
      post.diff = await relaiDiff(workspace, config, { maxBytes: args.maxBytes });
    } catch (error) {
      post.diff = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return post;
}

function attachPost(result, post) {
  if (post.checks) result.checks = post.checks;
  if (post.diff) result.diff = post.diff;
  // A failed post-check makes the whole call not-ok so callers do not treat a
  // broken build as a clean edit.
  if (post.checks?.ok === false) result.ok = false;
  return result;
}

// ---- Staged edit payloads ----------------------------------------------------
// Stream either a large patch (updateText) or a full-file replacement (content)
// through the same bounded payload store without exposing separate write tools.

async function handleStagedEdit(workspace, config, args) {
  const stage = String(args.stage || '').trim().toLowerCase();
  const hasPatchChunk = typeof args.updateText === 'string';
  const hasContentChunk = typeof args.content === 'string';

  if (stage === 'start') {
    if (hasPatchChunk === hasContentChunk) {
      throw new Error("relai_edit stage='start' requires exactly one of updateText or content.");
    }
    if (hasContentChunk) {
      const result = workspaceWrite(workspace, config, args);
      return { ...result, plannerPath: 'write:staged', plannerReason: 'content chunk provided — starting a staged full-file write' };
    }
    const writeId = makeOperationId();
    writeStagedPayload(config, workspace, writeId, {
      id: writeId, kind: 'patch', workspace: workspace.alias, root: workspace.path,
      chunks: [args.updateText], createdAt: new Date().toISOString()
    });
    return { ok: true, workspace: workspace.alias, operation: 'stagedPatch:start', writeId, chunks: 1,
      next: "Call relai_edit { stage:'append', writeId, updateText } for more chunks, then { stage:'commit', writeId }." };
  }

  if (stage === 'append') {
    if (hasPatchChunk === hasContentChunk) {
      throw new Error("relai_edit stage='append' requires exactly one of updateText or content.");
    }
    const writeId = resolveStagedWriteId(config, workspace, args.writeId, args.path);
    const payload = readStagedPayload(config, workspace, writeId);
    if (hasContentChunk) {
      if (payload.kind === 'patch') throw new Error('Staged payload is a patch, not a full-file write. Append updateText instead.');
      const result = workspaceWrite(workspace, config, { ...args, writeId });
      return { ...result, plannerPath: 'write:staged', plannerReason: 'content chunk provided — appending to a staged full-file write' };
    }
    if (payload.kind !== 'patch') throw new Error('Staged payload is a full-file write, not a patch. Append content instead.');
    payload.chunks.push(args.updateText);
    payload.updatedAt = new Date().toISOString();
    writeStagedPayload(config, workspace, writeId, payload);
    return { ok: true, workspace: workspace.alias, operation: 'stagedPatch:append', writeId, chunks: payload.chunks.length };
  }

  if (stage === 'commit' || stage === 'abort') {
    const writeId = resolveStagedWriteId(config, workspace, args.writeId, args.path);
    const payload = readStagedPayload(config, workspace, writeId);
    if (payload.kind !== 'patch') {
      const result = workspaceWrite(workspace, config, { ...args, writeId });
      const out = { ...result, plannerPath: 'write:staged', plannerReason: `staged full-file write ${stage}` };
      return stage === 'commit' ? attachPost(out, await runPostActions(workspace, config, args)) : out;
    }
    if (stage === 'abort') {
      const existed = clearStagedPayload(config, workspace, writeId);
      return { ok: true, workspace: workspace.alias, operation: 'stagedPatch:abort', writeId, cleared: existed };
    }
    const patch = payload.chunks.join('');
    const result = await relaiApplyPatch(workspace, config, { ...args, patch, returnDiff: false });
    if (!args.dryRun) clearStagedPayload(config, workspace, writeId);
    const out = { ...result, operation: 'stagedPatch:commit', writeId, plannerPath: 'apply-update:staged' };
    return attachPost(out, await runPostActions(workspace, config, args));
  }

  throw new Error("relai_edit stage must be one of: start, append, commit, abort.");
}

async function _handleBatchEdits(workspace, config, args) {
  const metrics = validateBatchEdits(workspace, args.edits);
  const compactResults = args.edits.length > BATCH_RESULT_COMPACT_THRESHOLD;
  const preflight = await preflightBatchEdits(workspace, config, args.edits, Boolean(args.dryRun));
  if (!preflight.ok || args.dryRun) {
    const out = {
      ok: preflight.ok,
      workspace: workspace.alias,
      plannerPath: 'batch',
      plannerReason: preflightPlannerReason(preflight),
      editCount: preflight.results.length,
      appliedCount: 0,
      preflightAtomic: true,
      rollbackAtomic: true,
      batchInputBytes: metrics.inputBytes,
      replacementCount: metrics.replacementCount,
      snapshotBytes: metrics.snapshotBytes,
      ...(compactResults ? { resultDetailsCompacted: true } : {}),
      results: formatBatchResults(preflight.results, compactResults)
    };
    return attachPost(out, await runPostActions(workspace, config, args));
  }

  const snapshotCapture = captureEditSnapshots(workspace, args.edits);
  const snapshots = snapshotCapture.snapshots;
  const results = [];
  let allOk = true;
  for (const edit of args.edits) {
    try {
      const r = await applyOneEdit(workspace, config, edit, false, { suppressJournal: true });
      results.push(r);
      if (r.ok === false) allOk = false;
    } catch (error) {
      results.push({ ok: false, path: edit.path, error: error instanceof Error ? error.message : String(error) });
      allOk = false;
      break;
    }
  }
  let rollback = null;
  if (!allOk) rollback = restoreEditSnapshots(snapshots);
  const changedFiles = allOk
    ? [...new Set(results.flatMap(item => Array.isArray(item.changedFiles) ? item.changedFiles : []))]
    : [];
  appendOperation(config, workspace, {
    id: makeOperationId(),
    type: 'batch_edit',
    ok: allOk,
    paths: changedFiles,
    results: results.map(item => ({ path: item.path, ok: item.ok !== false, changedFiles: item.changedFiles || [] })),
    ...(rollback ? { rollback } : {})
  });
  const out = {
    ok: allOk,
    workspace: workspace.alias,
    plannerPath: 'batch',
    plannerReason: `preflight passed; applied ${results.filter((item) => item.ok !== false).length} edit(s)`,
    editCount: args.edits.length,
    appliedCount: allOk ? results.filter((item) => item.ok !== false).length : 0,
    preflightAtomic: true,
    rollbackAtomic: rollback ? rollback.ok : true,
    batchInputBytes: metrics.inputBytes,
    replacementCount: metrics.replacementCount,
    snapshotBytes: snapshotCapture.bytes,
    changedFiles,
    ...(compactResults ? { resultDetailsCompacted: true } : {}),
    ...(rollback ? { rollback } : {}),
    preflight: formatBatchResults(preflight.results, compactResults),
    results: formatBatchResults(results, compactResults)
  };
  return attachPost(out, await runPostActions(workspace, config, args));
}

function captureEditSnapshots(workspace, edits) {
  const snapshots = new Map();
  let bytes = 0;
  for (const edit of edits) {
    const safe = resolveSafePath(workspace.path, edit.path);
    if (snapshots.has(safe.relativePath)) continue;
    const exists = fs.existsSync(safe.absolutePath);
    const stat = exists ? fs.statSync(safe.absolutePath) : null;
    if (stat?.isFile() && bytes + stat.size > MAX_BATCH_SNAPSHOT_BYTES) {
      throw new Error(`relai_edit rollback snapshots would exceed ${MAX_BATCH_SNAPSHOT_BYTES} bytes. Split the batch or use updateText.`);
    }
    const content = exists ? fs.readFileSync(safe.absolutePath) : null;
    bytes += content?.length || 0;
    if (bytes > MAX_BATCH_SNAPSHOT_BYTES) {
      throw new Error(`relai_edit rollback snapshots exceeded ${MAX_BATCH_SNAPSHOT_BYTES} bytes while files were changing. Retry with a smaller batch.`);
    }
    snapshots.set(safe.relativePath, {
      path: safe.relativePath,
      absolutePath: safe.absolutePath,
      exists,
      content,
      mode: stat?.mode ?? null
    });
  }
  return { snapshots: [...snapshots.values()], bytes };
}

function restoreEditSnapshots(snapshots) {
  const errors = [];
  for (const snapshot of snapshots) {
    try {
      if (!snapshot.exists) {
        fs.rmSync(snapshot.absolutePath, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(snapshot.absolutePath), { recursive: true });
      fs.writeFileSync(snapshot.absolutePath, snapshot.content);
      if (snapshot.mode != null) fs.chmodSync(snapshot.absolutePath, snapshot.mode);
    } catch (error) {
      errors.push({ path: snapshot.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ok: errors.length === 0, restored: snapshots.map(item => item.path), errors };
}

function formatBatchResults(results, compact) {
  if (!compact) return results;
  return results.map((item) => {
    const summary = {
      ok: item?.ok !== false,
      path: item?.path,
      operation: item?.operation,
      plannerPath: item?.plannerPath,
      changed: item?.changed,
      changedFiles: item?.changedFiles,
      error: item?.error,
      preflight: item?.preflight === true ? true : undefined
    };
    return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined));
  });
}

function preflightPlannerReason(preflight) {
  if (preflight.ok) return `preflight passed for ${preflight.results.length} edit(s); dryRun requested so 0 edits were applied`;
  return `preflight failed; applied 0 of ${preflight.results.length} edit(s)`;
}

function singlePlannerReason(hasReplacement, plannerPath) {
  if (hasReplacement) return 'exact replacement input provided without content — routing to deterministic text replacement';
  if (plannerPath === 'write:staged') return 'content provided — routing to staged chunked write';
  return 'content provided — routing to direct full-file write';
}

async function _handleUpdateTextEdit(workspace, config, args) {
  const result = await relaiApplyPatch(workspace, config, { ...args, patch: args.updateText, returnDiff: false });
  const out = { ...result, plannerPath: 'apply-update', plannerReason: 'updateText provided — routing to patch-shaped apply-update' };
  return attachPost(out, await runPostActions(workspace, config, args));
}

async function _handleSingleEdit(workspace, config, args) {
  const hasOldText = typeof args.oldText === 'string' && args.oldText.length > 0;
  const hasReplacements = Array.isArray(args.replacements) && args.replacements.length > 0;
  const hasReplacement = hasOldText || hasReplacements;
  const hasContent = typeof args.content === 'string';
  if (hasOldText && hasReplacements) {
    throw new Error('relai_edit: ambiguous — provide oldText+newText OR replacements:[...], not both');
  }
  if (hasReplacement && hasContent) {
    throw new Error('relai_edit: ambiguous — provide exact replacement input OR content for full-file write, not both');
  }
  if (!hasReplacement && !hasContent) {
    throw new Error('relai_edit: must provide one of: (1) oldText+newText or replacements:[...] for exact replacement, (2) content for full-file write, (3) updateText for patch-shaped update, (4) edits:[...] for a batch');
  }
  const single = await applyOneEdit(workspace, config, {
    path: args.path,
    oldText: args.oldText,
    newText: args.newText,
    occurrence: args.occurrence,
    replacements: args.replacements,
    content: args.content,
    expectedSha256: args.expectedSha256
  }, args.dryRun);
  single.plannerReason = singlePlannerReason(hasReplacement, single.plannerPath);
  return attachPost(single, await runPostActions(workspace, config, args));
}

async function planEdit(workspace, config, args) {
  if (typeof args.envAction === 'string' && args.envAction.trim()) {
    const result = runEnvOperation(workspace, config, args);
    return attachPost(result, await runPostActions(workspace, config, { ...args, returnDiff: false }));
  }
  if (typeof args.stage === 'string' && args.stage.trim()) return handleStagedEdit(workspace, config, args);
  if (Array.isArray(args.edits) && args.edits.length > 0) return _handleBatchEdits(workspace, config, args);
  if (typeof args.updateText === 'string' && args.updateText.length > 0) return _handleUpdateTextEdit(workspace, config, args);
  return _handleSingleEdit(workspace, config, args);
}

module.exports = { planEdit };
