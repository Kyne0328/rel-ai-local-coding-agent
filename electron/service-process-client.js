import { applyRuntimeLogChange } from './runtime-log-snapshot.js';

function createServiceProcessClient(options = {}) {
  const {
    utilityProcess,
    modulePath,
    cwd,
    env,
    nativeHandlers = {},
    onLog = () => {},
    onExit = () => {}
  } = options;
  if (!utilityProcess || typeof utilityProcess.fork !== 'function') throw new TypeError('Electron utilityProcess is required.');
  if (!modulePath) throw new TypeError('A service-process module path is required.');

  let child = null;
  let spawnPromise = null;
  let requestSequence = 0;
  let activePort = 0;
  let context = {};
  let currentActivity = emptyActivity();
  const pending = new Map();
  const activityListeners = new Set();

  const activitySource = {
    getToolActivity() { return cloneActivity(currentActivity); },
    onToolActivity(listener) {
      if (typeof listener !== 'function') return () => {};
      activityListeners.add(listener);
      return () => activityListeners.delete(listener);
    },
    resetToolActivity() {}
  };

  async function start(payload = {}) {
    await ensureChild();
    const result = await request('start', payload, 15_000);
    activePort = Number(result?.port || 0);
    return result;
  }

  async function stop() {
    if (!child) return { ok: true, cleanup: { clean: true, managedProcesses: { attempted: 0, stopped: 0, orphaned: 0 }, localService: { closed: true, forced: false } } };
    const result = await request('stop', {}, 12_000);
    activePort = 0;
    return result;
  }

  async function dashboardBootstrap() {
    await ensureChild();
    return request('dashboard-bootstrap', {}, 5_000);
  }

  function updateContext(patch = {}) {
    context = { ...context, ...patch };
    if (patch.runtimeLogChange) {
      context.runtimeLogs = applyRuntimeLogChange(context.runtimeLogs, patch.runtimeLogChange);
      delete context.runtimeLogChange;
    }
    sendContext(patch);
  }

  async function dispose(options = {}) {
    const owned = child;
    if (!owned) return;
    if (options.stop !== false) {
      try { await stop(); } catch {}
    }
    if (child !== owned) return;
    rejectPending(new Error('Rel.AI service process closed.'));
    owned.removeAllListeners();
    try { owned.kill(); } catch {}
    child = null;
    spawnPromise = null;
    activePort = 0;
  }

  function isListening() {
    return activePort > 0 && Boolean(child?.pid);
  }

  function port() {
    return activePort;
  }

  async function ensureChild() {
    if (child && spawnPromise) return spawnPromise;
    const utility = utilityProcess.fork(modulePath, [], {
      serviceName: 'Rel.AI MCP Service',
      stdio: 'pipe',
      ...(cwd ? { cwd } : {}),
      ...(env ? { env } : {})
    });
    child = utility;
    bindChild(utility);
    spawnPromise = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (action) => {
        if (settled) return;
        settled = true;
        utility.off('spawn', onSpawn);
        utility.off('exit', onEarlyExit);
        action();
      };
      const onSpawn = () => finish(resolve);
      const onEarlyExit = code => finish(() => reject(new Error(`Rel.AI service process exited during startup with code ${code}.`)));
      utility.once('spawn', onSpawn);
      utility.once('exit', onEarlyExit);
    });
    try {
      await spawnPromise;
      sendContext();
      return utility;
    } catch (error) {
      if (child === utility) {
        child = null;
        spawnPromise = null;
      }
      throw error;
    }
  }

  function bindChild(utility) {
    utility.on('message', message => handleMessage(utility, message));
    utility.on('exit', code => handleExit(utility, code));
    utility.stdout?.on('data', chunk => logChunk(chunk, 'info'));
    utility.stderr?.on('data', chunk => logChunk(chunk, 'warning'));
  }

  function handleMessage(utility, message = {}) {
    if (utility !== child) return;
    if (message.type === 'response') {
      settleResponse(message);
      return;
    }
    if (message.type === 'activity') {
      publishActivity(message.event || {});
      return;
    }
    if (message.type === 'native-request') void handleNativeRequest(utility, message);
  }

  function handleExit(utility, code) {
    if (utility !== child) return;
    child = null;
    spawnPromise = null;
    activePort = 0;
    currentActivity = emptyActivity();
    publishActivity({ phase: 'snapshot', snapshot: currentActivity });
    rejectPending(new Error(`Rel.AI service process exited with code ${code}.`));
    onExit({ code: Number(code || 0) });
  }

  function request(method, payload, timeoutMs) {
    const utility = child;
    if (!utility) return Promise.reject(new Error('Rel.AI service process is not running.'));
    const id = `request-${++requestSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Rel.AI service request timed out: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      utility.postMessage({ type: 'request', id, method, payload });
    });
  }

  function settleResponse(message) {
    const id = String(message.id || '');
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (message.ok) {
      entry.resolve(message.result);
      return;
    }
    const error = new Error(String(message.error?.message || 'Rel.AI service request failed.'));
    if (message.error?.code) error.code = String(message.error.code);
    entry.reject(error);
  }

  async function handleNativeRequest(utility, message) {
    const method = String(message.method || '');
    const handler = nativeHandlers[method];
    try {
      if (typeof handler !== 'function') throw new Error(`Unsupported native desktop request: ${method}`);
      const result = await handler(message.payload || {});
      if (utility === child) utility.postMessage({ type: 'native-response', id: message.id, ok: true, result });
    } catch (error) {
      if (utility === child) utility.postMessage({
        type: 'native-response', id: message.id, ok: false,
        error: { message: error instanceof Error ? error.message : String(error || 'Native desktop request failed.') }
      });
    }
  }

  function publishActivity(event = {}) {
    if (event.phase === 'snapshot' && event.snapshot) currentActivity = cloneActivity(event.snapshot);
    for (const listener of [...activityListeners]) {
      try { listener(event); } catch {}
    }
  }

  function sendContext(patch = context) {
    if (!child?.pid) return;
    child.postMessage({ type: 'context', context: patch });
  }

  function rejectPending(error) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  }

  function logChunk(chunk, level) {
    const text = String(chunk || '').trim();
    if (!text) return;
    onLog(text, { level, source: 'local-service' });
  }

  return {
    start,
    stop,
    dispose,
    dashboardBootstrap,
    updateContext,
    isListening,
    port,
    activitySource
  };
}

function emptyActivity() {
  return { state: 'idle', activeCalls: 0, activeTaskCount: 0, tasks: [], taskId: '', workspace: '', tool: '', operation: '', startedAt: null, lastTask: null };
}

function cloneActivity(activity = {}) {
  return {
    ...activity,
    tasks: Array.isArray(activity.tasks) ? activity.tasks.map(task => ({ ...task })) : [],
    lastTask: activity.lastTask ? { ...activity.lastTask } : null
  };
}

export { createServiceProcessClient };
