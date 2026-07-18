'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  relaiReplace,
  relaiWrite,
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

const STAGED_CHUNK_BYTES = 12000;

async function runStagedWrite(workspace, config, path, content, dryRun, suppressJournal = false) {
  const chunks = [];
  let offset = 0;
  while (offset < content.length) {
    chunks.push(content.slice(offset, offset + STAGED_CHUNK_BYTES));
    offset += STAGED_CHUNK_BYTES;
  }
  const startResult = relaiWrite(workspace, config, { stage: 'start', path, content: chunks[0], dryRun, suppressJournal });
  const { writeId } = startResult;
  for (let i = 1; i < chunks.length; i++) {
    relaiWrite(workspace, config, { stage: 'append', writeId, content: chunks[i], suppressJournal });
  }
  return relaiWrite(workspace, config, { stage: 'commit', writeId, dryRun, suppressJournal });
}

// Apply one logical edit: exact replacement when oldText is given, otherwise a
// full-file write (large content auto-routes to the staged chunked write).
async function applyOneEdit(workspace, config, edit, dryRun, options = {}) {
  const path = edit.path;
  const hasOldText = typeof edit.oldText === 'string' && edit.oldText.length > 0;
  const hasContent = typeof edit.content === 'string';

  if (hasOldText && hasContent) {
    throw new TypeError(`edit for ${path}: provide oldText+newText OR content, not both`);
  }
  if (!hasOldText && !hasContent) {
    throw new TypeError(`edit for ${path}: must provide oldText+newText (exact replace) or content (full-file write)`);
  }

  if (hasOldText) {
    if (typeof edit.newText !== 'string') {
      throw new TypeError(`edit for ${path}: newText is required (and must be a string) alongside oldText`);
    }
    const result = relaiReplace(workspace, config, { path, oldText: edit.oldText, newText: edit.newText, dryRun, suppressJournal: options.suppressJournal === true });
    return { ...result, path, plannerPath: 'replace' };
  }

  const contentBytes = Buffer.byteLength(edit.content, 'utf8');
  const lineCount = edit.content.split(/\r?\n/).length;
  if (contentBytes > STAGED_WRITE_BYTE_THRESHOLD || lineCount > STAGED_WRITE_LINE_THRESHOLD) {
    if (dryRun) {
      const result = relaiWrite(workspace, config, { path, content: edit.content, dryRun: true, suppressJournal: true });
      return { ...result, path, plannerPath: 'write:staged' };
    }
    const result = await runStagedWrite(workspace, config, path, edit.content, false, options.suppressJournal === true);
    return { ...result, path, plannerPath: 'write:staged' };
  }
  const result = relaiWrite(workspace, config, { path, content: edit.content, dryRun, suppressJournal: options.suppressJournal === true });
  return { ...result, path, plannerPath: 'write' };
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

// ---- Staged updateText (T4) -------------------------------------------------
// Lets a large diff be streamed across several calls instead of one oversized,
// classifier-flagged message. Reuses the staged-write payload store with a patch marker.

async function handleStagedPatch(workspace, config, args) {
  const stage = String(args.stage || '').trim().toLowerCase();
  if (stage === 'start') {
    if (typeof args.updateText !== 'string') throw new Error("relai_edit stage='start' requires an updateText chunk string.");
    const writeId = makeOperationId();
    writeStagedPayload(config, workspace, writeId, {
      id: writeId, kind: 'patch', workspace: workspace.alias, root: workspace.path,
      chunks: [args.updateText], createdAt: new Date().toISOString()
    });
    return { ok: true, workspace: workspace.alias, operation: 'stagedPatch:start', writeId, chunks: 1,
      next: "Call relai_edit { stage:'append', writeId, updateText } for more chunks, then { stage:'commit', writeId }." };
  }
  if (stage === 'append') {
    if (typeof args.updateText !== 'string') throw new Error("relai_edit stage='append' requires writeId and an updateText chunk string.");
    const writeId = resolveStagedWriteId(config, workspace, args.writeId);
    const payload = readStagedPayload(config, workspace, writeId);
    if (payload.kind !== 'patch') throw new Error('Staged payload is a file write, not a patch. Use relai_write to commit it.');
    payload.chunks.push(args.updateText);
    payload.updatedAt = new Date().toISOString();
    writeStagedPayload(config, workspace, writeId, payload);
    return { ok: true, workspace: workspace.alias, operation: 'stagedPatch:append', writeId, chunks: payload.chunks.length };
  }
  if (stage === 'commit') {
    const writeId = resolveStagedWriteId(config, workspace, args.writeId);
    const payload = readStagedPayload(config, workspace, writeId);
    if (payload.kind !== 'patch') throw new Error('Staged payload is a file write, not a patch. Use relai_write to commit it.');
    const patch = payload.chunks.join('');
    const result = await relaiApplyPatch(workspace, config, { ...args, patch });
    if (!args.dryRun) clearStagedPayload(config, workspace, writeId);
    const out = { ...result, operation: 'stagedPatch:commit', writeId, plannerPath: 'apply-update:staged' };
    return attachPost(out, await runPostActions(workspace, config, args));
  }
  if (stage === 'abort') {
    const writeId = resolveStagedWriteId(config, workspace, args.writeId);
    const existed = clearStagedPayload(config, workspace, writeId);
    return { ok: true, workspace: workspace.alias, operation: 'stagedPatch:abort', writeId, cleared: existed };
  }
  throw new Error("relai_edit stage must be one of: start, append, commit, abort.");
}

async function _handleBatchEdits(workspace, config, args) {
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
      results: preflight.results
    };
    return attachPost(out, await runPostActions(workspace, config, args));
  }

  const snapshots = captureEditSnapshots(workspace, args.edits);
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
    changedFiles,
    ...(rollback ? { rollback } : {}),
    preflight: preflight.results,
    results
  };
  return attachPost(out, await runPostActions(workspace, config, args));
}

function captureEditSnapshots(workspace, edits) {
  const snapshots = new Map();
  for (const edit of edits) {
    const safe = resolveSafePath(workspace.path, edit.path);
    if (snapshots.has(safe.relativePath)) continue;
    const exists = fs.existsSync(safe.absolutePath);
    snapshots.set(safe.relativePath, {
      path: safe.relativePath,
      absolutePath: safe.absolutePath,
      exists,
      content: exists ? fs.readFileSync(safe.absolutePath) : null,
      mode: exists ? fs.statSync(safe.absolutePath).mode : null
    });
  }
  return [...snapshots.values()];
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

function preflightPlannerReason(preflight) {
  if (preflight.ok) return `preflight passed for ${preflight.results.length} edit(s); dryRun requested so 0 edits were applied`;
  return `preflight failed; applied 0 of ${preflight.results.length} edit(s)`;
}

function singlePlannerReason(hasOldText, plannerPath) {
  if (hasOldText) return 'oldText provided without content — routing to exact text replacement';
  if (plannerPath === 'write:staged') return 'content provided — routing to staged chunked write';
  return 'content provided — routing to direct full-file write';
}

async function _handleUpdateTextEdit(workspace, config, args) {
  const result = await relaiApplyPatch(workspace, config, { ...args, patch: args.updateText });
  const out = { ...result, plannerPath: 'apply-update', plannerReason: 'updateText provided — routing to patch-shaped apply-update' };
  return attachPost(out, await runPostActions(workspace, config, args));
}

async function _handleSingleEdit(workspace, config, args) {
  const hasOldText = typeof args.oldText === 'string' && args.oldText.length > 0;
  const hasContent = typeof args.content === 'string';
  if (hasOldText && hasContent) {
    throw new Error('relai_edit: ambiguous — provide oldText+newText for exact replacement OR content for full-file write, not both');
  }
  if (!hasOldText && !hasContent) {
    throw new Error('relai_edit: must provide one of: (1) oldText+newText for exact replacement, (2) content for full-file write, (3) updateText for patch-shaped update, (4) edits:[...] for a batch');
  }
  const single = await applyOneEdit(workspace, config, { path: args.path, oldText: args.oldText, newText: args.newText, content: args.content }, args.dryRun);
  single.plannerReason = singlePlannerReason(hasOldText, single.plannerPath);
  return attachPost(single, await runPostActions(workspace, config, args));
}

async function planEdit(workspace, config, args) {
  if (typeof args.stage === 'string' && args.stage.trim()) return handleStagedPatch(workspace, config, args);
  if (Array.isArray(args.edits) && args.edits.length > 0) return _handleBatchEdits(workspace, config, args);
  if (typeof args.updateText === 'string' && args.updateText.length > 0) return _handleUpdateTextEdit(workspace, config, args);
  return _handleSingleEdit(workspace, config, args);
}

module.exports = { planEdit };
