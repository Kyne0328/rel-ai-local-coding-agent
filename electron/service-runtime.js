import { normalizePort, normalizeTunnelId, readGuiConfig } from './launcher-utils.js';
import { desktopStatusFailure, initialDesktopStatus } from './desktop-status.js';

function createDesktopServiceRuntime(deps) {
  const {
    app,
    connection,
    configModule,
    serviceProcessClient,
    dashboardWindowManager,
    runtimeLogs,
    secureTunnelRuntime,
    tunnelCredentials,
    errorCodes,
    getRuntimeAccess,
    getCurrentStatus,
    setStatus,
    replaceCurrentStatus,
    pushStatus
  } = deps;
  let startPromise = null;
  let localReadyPromise = null;
  let lifecycleToken = 0;

  function isListening() { return serviceProcessClient.isListening(); }

  async function startServer() {
    if (isListening() && secureTunnelRuntime.snapshot().state === 'running') {
      pushStatus();
      return getCurrentStatus();
    }
    if (startPromise) return startPromise;
    const runToken = ++lifecycleToken;
    const localReady = deferred();
    localReadyPromise = localReady.promise;
    const pendingStart = start(runToken, localReady.resolve);
    startPromise = pendingStart;
    void pendingStart
      .then(status => localReady.resolve(status), () => localReady.resolve(getCurrentStatus()))
      .finally(clearPending);
    return pendingStart;

    function clearPending() {
      if (startPromise === pendingStart) startPromise = null;
    }
  }

  async function start(runToken, markLocalReady) {
    let guiConfig;
    let apiKey;
    try {
      configModule.ensureConfig();
      guiConfig = readGuiConfig();
      guiConfig.port = normalizePort(guiConfig.port || 3333);
      guiConfig.tunnelId = normalizeTunnelId(guiConfig.tunnelId);
      apiKey = tunnelCredentials.getApiKey();
      if (!apiKey) throw new Error('OpenAI tunnel runtime API key is required. Open Connection settings to finish setup.');
      if (!guiConfig.token) {
        guiConfig.token = connection.generateToken(32);
        connection.writeLaunchEnv({ REL_AI_MCP_TOKEN: guiConfig.token });
      }
    } catch (error) {
      setStatus(desktopStatusFailure(errorCodes.CONFIGURATION_INVALID, error, {
        serverRunning: false,
        tunnelStatus: 'failed',
        tunnelId: '',
        mcpUrl: ''
      }));
      return getCurrentStatus();
    }

    let actualPort;
    try {
      serviceProcessClient.updateContext({
        status: getCurrentStatus(),
        runtimeAccess: getRuntimeAccess(),
        runtimeLogs: runtimeLogs.snapshot()
      });
      const localService = await serviceProcessClient.start({
        host: '127.0.0.1',
        port: guiConfig.port,
        token: guiConfig.token
      });
      actualPort = Number(localService.port || guiConfig.port);
    } catch (error) {
      const portInUse = error?.code === 'EADDRINUSE';
      const code = portInUse ? errorCodes.LOCAL_PORT_IN_USE : errorCodes.LOCAL_SERVICE_START_FAILED;
      const failure = portInUse ? `Port ${guiConfig.port} is already in use.` : error;
      setStatus(desktopStatusFailure(code, failure, {
        serverRunning: false,
        tunnelStatus: 'failed',
        tunnelId: guiConfig.tunnelId,
        mcpUrl: ''
      }));
      return getCurrentStatus();
    }

    const localUrl = `http://127.0.0.1:${actualPort}`;
    setStatus({
      serverRunning: true,
      tunnelStatus: 'connecting',
      tunnelId: guiConfig.tunnelId,
      tunnelHealthUrl: '',
      mcpUrl: '',
      localMcpUrl: `${localUrl}/mcp`,
      authenticationRequired: false,
      error: '',
      errorCode: '',
      localUrl
    });
    markLocalReady(getCurrentStatus());

    let result;
    try {
      result = await secureTunnelRuntime.start({
        tunnelId: guiConfig.tunnelId,
        port: actualPort,
        localToken: guiConfig.token,
        apiKey
      });
    } catch (error) {
      if (runToken !== lifecycleToken) return getCurrentStatus();
      setStatus(desktopStatusFailure(errorCodes.SECURE_TUNNEL_FAILED, error, {
        serverRunning: true,
        tunnelStatus: 'failed',
        tunnelId: guiConfig.tunnelId,
        mcpUrl: '',
        localMcpUrl: `${localUrl}/mcp`
      }));
      return getCurrentStatus();
    }
    if (runToken !== lifecycleToken || result.cancelled) return getCurrentStatus();

    connection.writeConnectionProfile({
      host: '127.0.0.1',
      port: actualPort,
      tunnelId: guiConfig.tunnelId,
      tunnelProvider: 'openai-secure-mcp',
      configPath: configModule.getConfigPath()
    });
    setStatus({
      serverRunning: true,
      tunnelStatus: 'running',
      tunnelId: guiConfig.tunnelId,
      tunnelHealthUrl: result.healthUrl || '',
      mcpUrl: '',
      localMcpUrl: `${localUrl}/mcp`,
      authenticationRequired: false,
      error: '',
      errorCode: '',
      localUrl
    });
    return getCurrentStatus();
  }

  async function waitUntilListening(timeoutMs = 10_000) {
    if (isListening()) return getCurrentStatus();
    const pending = localReadyPromise || startPromise;
    if (!pending) return getCurrentStatus();
    let timer = null;
    try {
      return await Promise.race([
        pending,
        new Promise(resolve => {
          timer = setTimeout(() => resolve(getCurrentStatus()), Math.max(1, Number(timeoutMs || 10_000)));
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function stopServer(options = {}) {
    lifecycleToken += 1;
    startPromise = null;
    localReadyPromise = null;
    const [localRuntime, secureTunnel] = await Promise.all([
      serviceProcessClient.stop().catch(error => ({
        ok: false,
        cleanup: {
          clean: false,
          managedProcesses: { attempted: 0, stopped: 0, orphaned: 1, error: formatError(error) },
          localService: { closed: false, forced: false, error: formatError(error) }
        }
      })),
      secureTunnelRuntime.stop().catch(error => ({ stopped: false, exited: false, error: formatError(error) }))
    ]);
    if (options.terminateUtility === true) await serviceProcessClient.dispose({ stop: false });
    if (!options.preserveDashboard) await dashboardWindowManager.close();
    const nextStatus = initialDesktopStatus(app.getVersion());
    replaceCurrentStatus(nextStatus, { silent: options.silent === true });
    const runtimeCleanup = localRuntime.cleanup || {};
    const cleanup = {
      clean: runtimeCleanup.clean !== false && secureTunnel.stopped !== false && secureTunnel.exited !== false,
      managedProcesses: runtimeCleanup.managedProcesses || { attempted: 0, stopped: 0, orphaned: 0 },
      secureTunnel,
      localService: runtimeCleanup.localService || { closed: true, forced: false }
    };
    return { ...nextStatus, cleanup };
  }

  async function buildDashboardConnection() {
    if (!isListening()) throw new Error('Local service is not running.');
    const authorization = await serviceProcessClient.dashboardBootstrap();
    const chrome = dashboardWindowManager.getState();
    const chromeMode = chrome.customTitleBar ? 'custom' : 'native';
    return {
      url: `http://127.0.0.1:${authorization.port}/dashboard?surface=desktop&chrome=${chromeMode}&platform=${encodeURIComponent(chrome.platform)}&bootstrap=${encodeURIComponent(authorization.bootstrap)}`,
      authGeneration: lifecycleToken
    };
  }

  return { startServer, stopServer, isListening, waitUntilListening, buildDashboardConnection };
}

function deferred() {
  let settled = false;
  let resolvePromise;
  const promise = new Promise(resolve => { resolvePromise = resolve; });
  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    }
  };
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

export { createDesktopServiceRuntime };
