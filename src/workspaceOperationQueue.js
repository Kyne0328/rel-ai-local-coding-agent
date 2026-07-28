'use strict';

// Per-workspace reader/writer lock.
//
// Every tool call used to serialize behind one FIFO chain per workspace alias, which
// meant a batch of read-only calls (the common ChatGPT pattern: several relai_read or
// relai_search calls in one JSON-RPC batch) ran strictly one at a time even though
// the transport already dispatched them in parallel. Reads now share the lock with
// each other while writers stay exclusive, so a mutation still never races a read.
//
// The queue is FIFO-fair: a waiting writer at the head blocks later readers, so a
// steady stream of reads cannot starve an edit.

const locks = new Map();

const READ = 'read';
const WRITE = 'write';

function lockStateFor(key) {
  let state = locks.get(key);
  if (!state) {
    state = { activeReaders: 0, activeWriter: false, queue: [] };
    locks.set(key, state);
  }
  return state;
}

function admitWaiting(state) {
  while (state.queue.length > 0) {
    const next = state.queue[0];
    if (next.mode === READ) {
      if (state.activeWriter) return;
      state.queue.shift();
      state.activeReaders += 1;
      next.admit();
      continue;
    }
    if (state.activeWriter || state.activeReaders > 0) return;
    state.queue.shift();
    state.activeWriter = true;
    next.admit();
    return;
  }
}

function acquire(state, mode) {
  const queuedAt = Date.now();
  return new Promise((resolve) => {
    state.queue.push({ mode, admit: () => resolve(Date.now() - queuedAt) });
    admitWaiting(state);
  });
}

function release(key, state, mode) {
  if (mode === READ) state.activeReaders = Math.max(0, state.activeReaders - 1);
  else state.activeWriter = false;
  admitWaiting(state);
  if (state.activeReaders === 0 && !state.activeWriter && state.queue.length === 0) {
    locks.delete(key);
  }
}

/**
 * Run `operation` under the workspace lock. `options.mode` is 'write' by default so
 * an un-annotated caller keeps the original exclusive behavior.
 */
async function runWorkspaceOperation(workspaceAlias, operation, options = {}) {
  const key = String(workspaceAlias || '').trim();
  if (!key) return operation();

  const mode = options.mode === READ ? READ : WRITE;
  const state = lockStateFor(key);
  const waitMs = await acquire(state, mode);
  if (typeof options.onWait === 'function') options.onWait(waitMs, { workspace: key, mode, queued: state.queue.length });
  try {
    return await operation();
  } finally {
    release(key, state, mode);
  }
}

function pendingWorkspaceOperations() {
  return locks.size;
}

module.exports = { runWorkspaceOperation, pendingWorkspaceOperations };
