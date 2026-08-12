import { isPortAvailable } from './launcher-config.js';
import { buildMcpUrl, normalizeNgrokAuthtoken, normalizeNgrokDomain, normalizePort, readGuiConfig } from './launcher-utils.js';
import { desktopStatusFailure, initialDesktopStatus, safeGatewayDesktopStatus } from './desktop-status.js';
import { closeHttpServer } from './shutdown-coordinator.js';

function createDesktopServiceRuntime(deps) {
  const {
    app, connection, configModule, startHttpServer, stopAllManagedProcesses, dashboardSessions, dashboardWindowManager,
    toolActivityRuntime, runtimeLogs, approvalTokenManager, publicConnectionRuntime, errorCodes, getRuntimeAccess,
    getCurrentStatus, setStatus, replaceCurrentStatus, pushStatus, applyGatewayStatus
  } = deps;
  let httpServer = null;
  let startPromise = null;
  let lifecycleToken = 0;

  function isListening() { return Boolean(httpServer?.listening); }

  async function startServer() {
    if (isListening()) { pushStatus(); return getCurrentStatus(); }
    if (startPromise) return startPromise;
    const runToken = ++lifecycleToken;
    const pendingStart = start(runToken);
    startPromise = pendingStart;
    void pendingStart.then(clearPending, clearPending);
    return pendingStart;
    function clearPending() { if (startPromise === pendingStart) startPromise = null; }
  }

  async function start(runToken) {
    let guiConfig;
    try {
      configModule.ensureConfig();
      guiConfig = readGuiConfig();
      guiConfig.port = normalizePort(guiConfig.port || 3333);
      if (guiConfig.connectionMode === 'direct') {
        guiConfig.ngrokDomain = normalizeNgrokDomain(guiConfig.ngrokDomain || '');
        guiConfig.ngrokAuthtoken = normalizeNgrokAuthtoken(guiConfig.ngrokAuthtoken || '');
      }
      if (!guiConfig.token) {
        guiConfig.token = connection.generateToken(32);
        connection.writeLaunchEnv({ REL_AI_MCP_TOKEN: guiConfig.token });
      }
    } catch (error) {
      setStatus(desktopStatusFailure(errorCodes.CONFIGURATION_INVALID, error, { serverRunning: false, tunnelStatus: 'failed', mcpUrl: '' }));
      return getCurrentStatus();
    }
    if (!await isPortAvailable(guiConfig.port)) {
      setStatus(desktopStatusFailure(errorCodes.LOCAL_PORT_IN_USE, `Port ${guiConfig.port} is already in use.`, { serverRunning: false, tunnelStatus: 'failed', mcpUrl: '' }));
      return getCurrentStatus();
    }

    let actualPort;
    try {
      httpServer = startHttpServer({
        host: '127.0.0.1', port: guiConfig.port, token: guiConfig.token,
        publicUrl: guiConfig.connectionMode === 'direct' ? `https://${guiConfig.ngrokDomain}` : '', exitOnError: false,
        pickFolder: () => dashboardWindowManager.pickFolder(), openFolder: folderPath => dashboardWindowManager.openFolder(folderPath),
        getTaskActivity: toolActivityRuntime.getStatus, getDesktopStatus: getCurrentStatus, getRuntimeAccess,
        resetTaskActivity: toolActivityRuntime.resetHistory, getRuntimeLogs: runtimeLogs.snapshot, clearRuntimeLogs: runtimeLogs.clear,
        onOAuthAuthorized: () => { if (guiConfig.connectionMode === 'direct') setStatus({ authenticationRequired: false, error: '', errorCode: '' }); }
      });
      actualPort = await waitForListening(httpServer);
    } catch (error) {
      httpServer = null;
      setStatus(desktopStatusFailure(errorCodes.LOCAL_SERVICE_START_FAILED, error, { serverRunning: false, tunnelStatus: 'failed', mcpUrl: '' }));
      return getCurrentStatus();
    }

    const localUrl = `http://127.0.0.1:${actualPort}`;
    const initialMcpUrl = guiConfig.connectionMode === 'cloud' ? buildMcpUrl(guiConfig.gatewayOrigin) : '';
    setStatus({
      serverRunning: true, connectionMode: guiConfig.connectionMode,
      gateway: guiConfig.connectionMode === 'cloud' ? safeGatewayDesktopStatus({ state: 'connecting', gatewayOrigin: guiConfig.gatewayOrigin }, guiConfig.gatewayOrigin) : null,
      tunnelStatus: 'connecting', mcpUrl: initialMcpUrl,
      authenticationRequired: guiConfig.connectionMode === 'cloud' ? false : approvalTokenManager.status().required,
      error: '', errorCode: '', localUrl
    });
    if (guiConfig.connectionMode === 'direct') { void completeDirectPublicStart(guiConfig, actualPort, runToken); return getCurrentStatus(); }

    let result;
    try { result = await publicConnectionRuntime.start({ ...guiConfig, port: actualPort }); }
    catch (error) {
      if (runToken !== lifecycleToken) return getCurrentStatus();
      setStatus(desktopStatusFailure(errorCodes.PUBLIC_ENDPOINT_FAILED, error, {
        serverRunning: true, connectionMode: guiConfig.connectionMode, tunnelStatus: 'failed', mcpUrl: initialMcpUrl
      }));
      return getCurrentStatus();
    }
    if (runToken !== lifecycleToken) return getCurrentStatus();
    connection.writeConnectionProfile({
      host: '127.0.0.1', port: actualPort, connectionMode: 'cloud', gatewayOrigin: guiConfig.gatewayOrigin,
      publicUrl: '', tunnelProvider: 'rel-ai-gateway', configPath: configModule.getConfigPath()
    });
    if (result.status) applyGatewayStatus(result.status);
    return getCurrentStatus();
  }

  async function completeDirectPublicStart(guiConfig, actualPort, runToken) {
    let result;
    try { result = await publicConnectionRuntime.start({ ...guiConfig, port: actualPort }); }
    catch (error) {
      if (runToken !== lifecycleToken) return;
      setStatus(desktopStatusFailure(errorCodes.PUBLIC_ENDPOINT_FAILED, error, { serverRunning: true, connectionMode: 'direct', gateway: null, tunnelStatus: 'failed', mcpUrl: '' }));
      return;
    }
    if (runToken !== lifecycleToken || result.cancelled) return;
    if (!result.ok) {
      setStatus(desktopStatusFailure(errorCodes.PUBLIC_ENDPOINT_FAILED, result.error || 'Tunnel failed before publishing a public URL.', { serverRunning: true, connectionMode: 'direct', gateway: null, tunnelStatus: 'failed', mcpUrl: '' }));
      return;
    }
    const publicBaseUrl = `https://${guiConfig.ngrokDomain}`;
    const mcpUrl = buildMcpUrl(publicBaseUrl);
    connection.writeConnectionProfile({
      host: '127.0.0.1', port: actualPort, connectionMode: 'direct', gatewayOrigin: guiConfig.gatewayOrigin,
      publicUrl: publicBaseUrl, ngrokDomain: guiConfig.ngrokDomain, tunnelProvider: 'managed-ngrok', configPath: configModule.getConfigPath()
    });
    setStatus({ serverRunning: true, connectionMode: 'direct', gateway: null, tunnelStatus: 'running', mcpUrl, authenticationRequired: approvalTokenManager.status().required, error: '', errorCode: '' });
  }

  async function stopServer(options = {}) {
    lifecycleToken += 1;
    const runtimeConfig = configModule.readConfig();
    const ownedServer = httpServer;
    httpServer = null;
    startPromise = null;
    const [managedProcesses, publicConnection, localService] = await Promise.all([
      stopAllManagedProcesses(runtimeConfig).catch(error => ({ attempted: 0, stopped: 0, orphaned: 1, error: formatError(error) })),
      publicConnectionRuntime.stop().catch(error => ({ mode: publicConnectionRuntime.snapshot().mode, stopped: false, exited: false, error: formatError(error) })),
      closeHttpServer(ownedServer)
    ]);
    if (!options.preserveDashboard) dashboardWindowManager.close();
    dashboardSessions.clearDashboardSessions();
    const nextStatus = initialDesktopStatus(app.getVersion());
    replaceCurrentStatus(nextStatus, { silent: options.silent === true });
    const directExited = publicConnection.mode !== 'direct' || publicConnection.exited !== false;
    const publicStopped = publicConnection.stopped !== false;
    return {
      ...nextStatus,
      cleanup: {
        clean: managedProcesses.orphaned === 0 && publicStopped && directExited && localService.closed !== false,
        managedProcesses, publicConnection,
        tunnel: publicConnection.mode === 'direct' ? publicConnection : { exited: true, forced: false }, localService
      }
    };
  }

  function buildDashboardConnection() {
    const port = (httpServer?.listening && httpServer.address()?.port) || readGuiConfig().port || 3333;
    const token = connection.readLaunchEnv().REL_AI_MCP_TOKEN || readGuiConfig().token || '';
    const bootstrap = dashboardSessions.createDashboardBootstrap(token);
    const chrome = dashboardWindowManager.getState();
    const chromeMode = chrome.customTitleBar ? 'custom' : 'native';
    return {
      url: `http://127.0.0.1:${port}/dashboard?surface=desktop&chrome=${chromeMode}&platform=${encodeURIComponent(chrome.platform)}&bootstrap=${encodeURIComponent(bootstrap)}`,
      authGeneration: lifecycleToken
    };
  }

  return { startServer, stopServer, isListening, buildDashboardConnection };
}

function waitForListening(server) {
  return new Promise((resolve, reject) => {
    server.once('listening', () => resolve(server.address().port));
    server.once('error', reject);
  });
}

function formatError(error) { return error instanceof Error ? error.message : String(error || 'Unknown error'); }

export { createDesktopServiceRuntime };
