// Hierarchical workspace/task reader-writer queue.
//
// Normal tool calls share a workspace-level read barrier and then acquire a
// task-local reader/writer lane. This keeps calls within one logical task ordered
// while allowing independent ChatGPT sessions/tasks to work in the same workspace
// concurrently. Repository-global operations acquire the workspace barrier as a
// writer, so commit, push, reset, restore, tidy, and worktree changes remain
// exclusive across every task.
//
// Both levels are FIFO-fair: a waiting writer blocks later readers, preventing
// workspace-global maintenance and task-local writes from starving.

const locks = new Map();

const READ = 'read';
const WRITE = 'write';
const TASK_SCOPE = 'task';
const WORKSPACE_SCOPE = 'workspace';

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

async function withLock(key, mode, operation) {
  const state = lockStateFor(key);
  const waitMs = await acquire(state, mode);
  try {
    return await operation(waitMs, state);
  } finally {
    release(key, state, mode);
  }
}

function workspaceKey(workspace) {
  return `workspace:${workspace}`;
}

function taskKey(workspace, taskId) {
  return `workspace:${workspace}:task:${taskId}`;
}

function notifyWait(options, waitMs, details) {
  if (typeof options.onWait !== 'function') return;
  try {
    options.onWait(waitMs, details);
  } catch {
    // Observability must never strand an acquired lock or fail the operation.
  }
}

/**
 * Run `operation` under hierarchical workspace/task locking.
 *
 * Task scope is the default when `taskId` is present. Calls in different tasks may
 * overlap, while calls in the same task retain reader/writer ordering. Workspace
 * scope is reserved for repository-global operations that must exclude every task.
 * Calls without a task identity retain the original workspace-level behavior.
 */
async function runWorkspaceOperation(workspaceAlias, operation, options = {}) {
  const workspace = String(workspaceAlias || '').trim();
  if (!workspace) return operation();

  const mode = options.mode === READ ? READ : WRITE;
  const taskId = String(options.taskId || '').trim();
  const scope = options.scope === WORKSPACE_SCOPE || !taskId ? WORKSPACE_SCOPE : TASK_SCOPE;
  const outerKey = workspaceKey(workspace);

  if (scope === WORKSPACE_SCOPE) {
    return withLock(outerKey, mode, async (waitMs, state) => {
      notifyWait(options, waitMs, {
        workspace,
        taskId,
        scope,
        mode,
        queued: state.queue.length
      });
      return operation();
    });
  }

  return withLock(outerKey, READ, async (workspaceWaitMs, workspaceState) => {
    const laneKey = taskKey(workspace, taskId);
    return withLock(laneKey, mode, async (taskWaitMs, taskState) => {
      const waitMs = workspaceWaitMs + taskWaitMs;
      notifyWait(options, waitMs, {
        workspace,
        taskId,
        scope,
        mode,
        queued: workspaceState.queue.length + taskState.queue.length
      });
      return operation();
    });
  });
}

function pendingWorkspaceOperations() {
  return locks.size;
}

export { runWorkspaceOperation, pendingWorkspaceOperations };
