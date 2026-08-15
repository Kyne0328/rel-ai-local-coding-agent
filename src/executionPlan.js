import { performance } from 'node:perf_hooks';

const DEFAULT_MAX_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;

function step(name, run, options = {}) {
  if (typeof run !== 'function') throw new TypeError('execution plan step requires a run function');
  return Object.freeze({
    type: 'step',
    name: String(name || 'step'),
    run,
    isSuccess: typeof options.isSuccess === 'function' ? options.isSuccess : null,
    metadata: options.metadata && typeof options.metadata === 'object' ? { ...options.metadata } : {}
  });
}

function parallel(children, options = {}) {
  return group('parallel', children, {
    maxConcurrency: clampConcurrency(options.maxConcurrency),
    stopOnFailure: options.stopOnFailure === true
  });
}

function sequence(children, options = {}) {
  return group('sequence', children, {
    maxConcurrency: 1,
    stopOnFailure: options.stopOnFailure !== false
  });
}

function group(type, children, options) {
  if (!Array.isArray(children) || children.length === 0) throw new TypeError(`execution plan ${type} group requires at least one child`);
  return Object.freeze({ type, children: [...children], ...options });
}

async function runPlan(plan, options = {}) {
  const state = {
    signal: options.signal,
    onEvent: typeof options.onEvent === 'function' ? options.onEvent : null,
    active: 0,
    maxActive: 0,
    completed: 0,
    total: countSteps(plan),
    stepDurationMs: 0,
    failedSteps: 0
  };
  const started = performance.now();
  const outcome = await executeNode(plan, state);
  const wallTimeMs = performance.now() - started;
  return {
    ...outcome,
    metrics: {
      wallTimeMs: round(wallTimeMs),
      accumulatedStepTimeMs: round(state.stepDurationMs),
      parallelTimeSavedMs: round(Math.max(0, state.stepDurationMs - wallTimeMs)),
      maxParallelism: state.maxActive,
      stepCount: state.total,
      completedStepCount: state.completed,
      failedStepCount: state.failedSteps
    }
  };
}

async function executeNode(node, state) {
  if (!node || typeof node !== 'object') throw new TypeError('execution plan node is required');
  if (node.type === 'step') return executeStep(node, state);
  if (node.type === 'parallel') return executeParallel(node, state);
  if (node.type === 'sequence') return executeSequence(node, state);
  throw new TypeError(`unsupported execution plan node type '${node.type}'`);
}

async function executeStep(node, state) {
  if (state.signal?.aborted) return cancelledStep(node, state);
  const started = performance.now();
  state.active += 1;
  state.maxActive = Math.max(state.maxActive, state.active);
  emit(state, { type: 'step_started', name: node.name, metadata: node.metadata });
  try {
    const value = await node.run({ signal: state.signal });
    const ok = node.isSuccess ? node.isSuccess(value) !== false : true;
    const durationMs = performance.now() - started;
    state.stepDurationMs += durationMs;
    state.completed += 1;
    if (!ok) state.failedSteps += 1;
    const result = { type: 'step', name: node.name, ok, value, durationMs: round(durationMs), metadata: node.metadata };
    emit(state, { type: 'step_completed', ...result });
    return result;
  } catch (error) {
    const durationMs = performance.now() - started;
    state.stepDurationMs += durationMs;
    state.completed += 1;
    state.failedSteps += 1;
    const result = { type: 'step', name: node.name, ok: false, error, durationMs: round(durationMs), metadata: node.metadata };
    emit(state, { type: 'step_completed', ...result });
    return result;
  } finally {
    state.active = Math.max(0, state.active - 1);
  }
}

function cancelledStep(node, state) {
  state.completed += 1;
  state.failedSteps += 1;
  const result = {
    type: 'step',
    name: node.name,
    ok: false,
    cancelled: true,
    error: abortError(state.signal),
    durationMs: 0,
    metadata: node.metadata
  };
  emit(state, { type: 'step_completed', ...result });
  return result;
}

async function executeSequence(node, state) {
  const results = [];
  for (const child of node.children) {
    if (state.signal?.aborted) break;
    const result = await executeNode(child, state);
    results.push(result);
    if (node.stopOnFailure && result.ok === false) break;
  }
  return { type: 'sequence', ok: results.length === node.children.length && results.every(item => item.ok !== false), results };
}

async function executeParallel(node, state) {
  const results = new Array(node.children.length);
  let nextIndex = 0;
  let stopScheduling = false;

  async function worker() {
    while (!stopScheduling && !state.signal?.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= node.children.length) return;
      const result = await executeNode(node.children[index], state);
      results[index] = result;
      if (node.stopOnFailure && result.ok === false) stopScheduling = true;
    }
  }

  const workerCount = Math.min(node.maxConcurrency, node.children.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const scheduled = results.filter(Boolean);
  return {
    type: 'parallel',
    ok: scheduled.length === node.children.length && scheduled.every(item => item.ok !== false),
    results: scheduled,
    scheduledCount: scheduled.length,
    totalCount: node.children.length
  };
}

function emit(state, event) {
  if (!state.onEvent) return;
  try {
    state.onEvent({
      ...event,
      active: state.active,
      completed: state.completed,
      total: state.total
    });
  } catch {
    // Observability must never break execution.
  }
}

function countSteps(node) {
  if (node?.type === 'step') return 1;
  if (Array.isArray(node?.children)) return node.children.reduce((sum, child) => sum + countSteps(child), 0);
  return 0;
}

function clampConcurrency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_MAX_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(numeric)));
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('Execution plan cancelled.');
  error.name = 'AbortError';
  return error;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

export { parallel, runPlan, sequence, step };
