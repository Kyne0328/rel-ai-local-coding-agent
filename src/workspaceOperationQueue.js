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
// workspace-global maintenance and task-local writes from starving. Waiting calls
// are abort-aware so a disconnected MCP request never remains queued until an
// unrelated operation eventually releases its lock.

const locks = new Map();

const READ = 'read';
const WRITE = 'write';
const TASK_SCOPE = 'task';
const MUTATION_SCOPE = 'mutation';
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

function acquire(state, mode, signal) {
  throwIfAborted(signal);
  const queuedAt = Date.now();
  return new Promise((resolve, reject) => {
    const entry = {
      mode,
      settled: false,
      admit: () => {
        if (entry.settled) return;
        entry.settled = true;
        signal?.removeEventListener?.('abort', onAbort);
        resolve(Date.now() - queuedAt);
      }
    };
    const onAbort = () => {
      if (entry.settled) return;
      const index = state.queue.indexOf(entry);
      if (index < 0) return;
      state.queue.splice(index, 1);
      entry.settled = true;
      signal?.removeEventListener?.('abort', onAbort);
      reject(workspaceOperationAbortError(signal));
      admitWaiting(state);
    };

    state.queue.push(entry);
    signal?.addEventListener?.('abort', onAbort, { once: true });
    admitWaiting(state);
  });
}

function release(key, state, mode) {
  if (mode === READ) state.activeReaders = Math.max(0, state.activeReaders - 1);
  else state.activeWriter = false;
  admitWaiting(state);
  deleteIdleLock(key, state);
}

function deleteIdleLock(key, state) {
  if (state.activeReaders === 0 && !state.activeWriter && state.queue.length === 0) {
    locks.delete(key);
  }
}

async function withLock(key, mode, operation, signal) {
  const state = lockStateFor(key);
  let waitMs;
  try {
    waitMs = await acquire(state, mode, signal);
  } catch (error) {
    deleteIdleLock(key, state);
    throw error;
  }
  try {
    // The signal can flip after admission resolves but before this continuation
    // resumes. In that race, release the acquired lock without invoking work.
    throwIfAborted(signal);
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

function mutationKey(workspace) {
  return `workspace:${workspace}:mutation`;
}

function notifyWait(options, waitMs, details) {
  if (typeof options.onWait !== 'function') return;
  try {
    options.onWait(waitMs, details);
  } catch {
    // Observability must never strand an acquired lock or fail the operation.
  }
}

function workspaceOperationAbortError(signal) {
  const reason = signal?.reason;
  const message = reason instanceof Error && reason.message
    ? reason.message
    : 'Workspace operation was cancelled before execution.';
  const error = new Error(message, reason instanceof Error ? { cause: reason } : undefined);
  error.name = 'AbortError';
  error.code = 'WORKSPACE_OPERATION_ABORTED';
  error.retryable = true;
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw workspaceOperationAbortError(signal);
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
  if (!workspace) {
    throwIfAborted(options.signal);
    return operation();
  }

  const mode = options.mode === READ ? READ : WRITE;
  const taskId = String(options.taskId || '').trim();
  const requestedScope = String(options.scope || '');
  const scope = !taskId
    ? WORKSPACE_SCOPE
    : requestedScope === WORKSPACE_SCOPE
      ? WORKSPACE_SCOPE
      : requestedScope === MUTATION_SCOPE
        ? MUTATION_SCOPE
        : TASK_SCOPE;
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
    }, options.signal);
  }

  if (scope === MUTATION_SCOPE) {
    return withLock(outerKey, READ, async (workspaceWaitMs, workspaceState) => {
      const laneKey = taskKey(workspace, taskId);
      return withLock(laneKey, mode, async (taskWaitMs, taskState) => {
        return withLock(mutationKey(workspace), WRITE, async (mutationWaitMs, mutationState) => {
          const waitMs = workspaceWaitMs + taskWaitMs + mutationWaitMs;
          notifyWait(options, waitMs, {
            workspace,
            taskId,
            scope,
            mode,
            queued: workspaceState.queue.length + taskState.queue.length + mutationState.queue.length
          });
          return operation();
        }, options.signal);
      }, options.signal);
    }, options.signal);
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
    }, options.signal);
  }, options.signal);
}

function runWorkspaceMutationBoundary(workspaceAlias, operation, options = {}) {
  const workspace = String(workspaceAlias || '').trim();
  if (!workspace) {
    throwIfAborted(options.signal);
    return operation();
  }
  return withLock(mutationKey(workspace), WRITE, async (waitMs, state) => {
    notifyWait(options, waitMs, {
      workspace,
      taskId: String(options.taskId || '').trim(),
      scope: MUTATION_SCOPE,
      mode: WRITE,
      queued: state.queue.length
    });
    return operation();
  }, options.signal);
}

function pendingWorkspaceOperations() {
  return locks.size;
}

export { runWorkspaceMutationBoundary, runWorkspaceOperation, pendingWorkspaceOperations };
