import { closeHttpServer } from './shutdown-coordinator.js';
import { importResourceModule } from './resource-path.js';
import { applyRuntimeLogChange } from './runtime-log-snapshot.js';
import { projectServiceActivityEvent, projectServiceActivitySnapshot } from './service-activity-projection.js';

const parentPort = process.parentPort;
if (!parentPort) throw new Error('Rel.AI service process requires an Electron utility-process parent port.');

const [httpModule, toolActivity, dashboardSessions, processManager, configModule] = await Promise.all([
  importResourceModule('src/httpServer.js'),
  importResourceModule('src/toolActivity.js'),
  importResourceModule('src/http/dashboardSessions.js'),
  importResourceModule('src/processManager.js'),
  importResourceModule('src/config.js')
]);

let httpServer = null;
let activeToken = '';
let activePort = 0;
let desktopContext = {
  status: null,
  runtimeAccess: { blocked: false, errorCode: '', message: '' },
  runtimeLogs: { available: true, revision: 0, count: 0, entries: [] }
};
let nativeRequestSequence = 0;
const pendingNativeRequests = new Map();
const runtimeLogListeners = new Set();

const unsubscribeActivity = toolActivity.onToolActivity(event => {
  const projected = projectServiceActivityEvent(event);
  if (projected) post({ type: 'activity', event: projected });
});

parentPort.on('message', event => {
  const message = event?.data || {};
  if (message.type === 'request') {
    void handleRequest(message);
    return;
  }
  if (message.type === 'context') {
    updateDesktopContext(message.context);
    return;
  }
  if (message.type === 'native-response') settleNativeRequest(message);
});

async function handleRequest(message) {
  const id = String(message.id || '');
  try {
    const result = await dispatchRequest(String(message.method || ''), message.payload || {});
    post({ type: 'response', id, ok: true, result });
  } catch (error) {
    post({
      type: 'response',
      id,
      ok: false,
      error: {
        message: errorMessage(error),
        code: String(error?.code || '')
      }
    });
  }
}

async function dispatchRequest(method, payload) {
  if (method === 'start') return startService(payload);
  if (method === 'stop') return stopService();
  if (method === 'dashboard-bootstrap') return createDashboardBootstrap();
  if (method === 'activity-snapshot') return projectServiceActivitySnapshot(toolActivity.getToolActivity());
  throw new Error(`Unknown service-process request: ${method}`);
}

async function startService(payload = {}) {
  if (httpServer?.listening) {
    publishActivitySnapshot();
    return { ok: true, port: activePort };
  }
  const host = String(payload.host || '127.0.0.1');
  const port = Number(payload.port || 3333);
  const token = String(payload.token || '');
  let server = null;
  try {
    server = httpModule.startHttpServer({
      host,
      port,
      token,
      publicUrl: '',
      exitOnError: false,
      writeProfile: false,
      stopManagedProcessesOnClose: false,
      pickFolder: () => callNative('pickFolder'),
      openFolder: folderPath => callNative('openFolder', { path: folderPath }),
      getTaskActivity: () => toolActivity.getToolActivity(),
      getDesktopStatus: () => desktopContext.status,
      getRuntimeAccess: () => desktopContext.runtimeAccess,
      resetTaskActivity: () => {
        toolActivity.resetToolActivity();
        return { ok: true };
      },
      getRuntimeLogs: options => runtimeLogSnapshot(options),
      clearRuntimeLogs: () => callNative('clearRuntimeLogs'),
      onRuntimeLogChange: listener => {
        if (typeof listener !== 'function') return () => {};
        runtimeLogListeners.add(listener);
        return () => runtimeLogListeners.delete(listener);
      }
    });
    const actualPort = await waitForListening(server);
    httpServer = server;
    activeToken = token;
    activePort = actualPort;
    publishActivitySnapshot();
    return { ok: true, port: actualPort };
  } catch (error) {
    try { server?.closeAllConnections?.(); } catch {}
    if (server?.listening) await closeHttpServer(server).catch(() => {});
    httpServer = null;
    activeToken = '';
    activePort = 0;
    throw error;
  }
}

async function stopService() {
  const ownedServer = httpServer;
  httpServer = null;
  activeToken = '';
  activePort = 0;
  const runtimeConfig = configModule.readConfig();
  const [managedProcesses, localService] = await Promise.all([
    processManager.stopAllManagedProcesses(runtimeConfig)
      .catch(error => ({ attempted: 0, stopped: 0, orphaned: 1, error: errorMessage(error) })),
    closeHttpServer(ownedServer)
  ]);
  dashboardSessions.clearDashboardSessions();
  publishActivitySnapshot();
  return {
    ok: managedProcesses.orphaned === 0 && localService.closed !== false,
    cleanup: {
      clean: managedProcesses.orphaned === 0 && localService.closed !== false,
      managedProcesses,
      localService
    }
  };
}

function createDashboardBootstrap() {
  if (!httpServer?.listening || !activeToken || !activePort) throw new Error('Local service is not running.');
  return {
    ok: true,
    port: activePort,
    bootstrap: dashboardSessions.createDashboardBootstrap(activeToken)
  };
}

function updateDesktopContext(next = {}) {
  desktopContext = {
    ...desktopContext,
    ...(Object.hasOwn(next, 'status') ? { status: next.status } : {}),
    ...(Object.hasOwn(next, 'runtimeAccess') ? { runtimeAccess: next.runtimeAccess } : {}),
    ...(Object.hasOwn(next, 'runtimeLogs') ? { runtimeLogs: next.runtimeLogs } : {})
  };
  if (next.runtimeLogChange) {
    desktopContext.runtimeLogs = applyRuntimeLogChange(desktopContext.runtimeLogs, next.runtimeLogChange);
    for (const listener of [...runtimeLogListeners]) {
      try { listener(next.runtimeLogChange); } catch {}
    }
  }
}

function runtimeLogSnapshot(options = {}) {
  const snapshot = desktopContext.runtimeLogs || { available: true, revision: 0, count: 0, entries: [] };
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  const limit = Math.max(1, Math.min(entries.length || 1, Number(options.limit || entries.length || 1)));
  return { ...snapshot, entries: entries.slice(-limit) };
}

function callNative(method, payload = {}) {
  const id = `native-${++nativeRequestSequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingNativeRequests.delete(id);
      reject(new Error(`Native desktop request timed out: ${method}`));
    }, 30_000);
    timer.unref?.();
    pendingNativeRequests.set(id, { resolve, reject, timer });
    post({ type: 'native-request', id, method, payload });
  });
}

function settleNativeRequest(message) {
  const entry = pendingNativeRequests.get(String(message.id || ''));
  if (!entry) return;
  pendingNativeRequests.delete(String(message.id || ''));
  clearTimeout(entry.timer);
  if (message.ok) entry.resolve(message.result);
  else entry.reject(new Error(String(message.error?.message || 'Native desktop request failed.')));
}

function publishActivitySnapshot() {
  post({
    type: 'activity',
    event: { phase: 'snapshot', snapshot: projectServiceActivitySnapshot(toolActivity.getToolActivity()) }
  });
}

function waitForListening(server) {
  if (server?.listening) return Promise.resolve(server.address().port);
  return new Promise((resolve, reject) => {
    const onListening = () => finish(() => resolve(server.address().port));
    const onError = error => finish(() => reject(error));
    server.once('listening', onListening);
    server.once('error', onError);
    function finish(action) {
      server.off('listening', onListening);
      server.off('error', onError);
      action();
    }
  });
}

function post(message) {
  parentPort.postMessage(message);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

process.once('beforeExit', () => {
  unsubscribeActivity?.();
});
