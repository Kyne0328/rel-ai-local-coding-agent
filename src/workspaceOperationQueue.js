'use strict';

const tails = new Map();

async function runWorkspaceOperation(workspaceAlias, operation) {
  const key = String(workspaceAlias || '').trim();
  if (!key) return operation();

  const previous = tails.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  tails.set(key, current);

  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (tails.get(key) === current) tails.delete(key);
  }
}

function pendingWorkspaceOperations() {
  return tails.size;
}

module.exports = { runWorkspaceOperation, pendingWorkspaceOperations };
