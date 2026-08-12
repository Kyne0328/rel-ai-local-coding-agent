import { saveLauncherConfig } from './launcher-config.js';
import { buildMcpUrl, readGuiConfig } from './launcher-utils.js';
import { desktopStatusFailure, gatewayAuthorizationRequired, safeGatewayDesktopStatus } from './desktop-status.js';

function createGatewayActions(deps) {
  const {
    publicConnectionRuntime, gatewayDeviceIdentity, shell, dashboardWindowManager,
    formatDeviceLinkCode, formatRecoveryCode, errorCodes, getCurrentStatus, setStatus,
    launchConfiguredDesktop, isHttpServerListening
  } = deps;

  function statusForDashboard() {
    let config = {};
    try { config = readGuiConfig(); } catch {}
    const currentStatus = getCurrentStatus();
    const raw = publicConnectionRuntime.gatewaySnapshot() || currentStatus.gateway || {};
    return {
      ok: true,
      connectionMode: String(config.connectionMode || currentStatus.connectionMode || ''),
      gateway: safeGatewayDesktopStatus(raw, config.gatewayOrigin || raw.gatewayOrigin || '')
    };
  }

  async function beginPairing(options = {}) {
    const pairing = await publicConnectionRuntime.gatewayCall('beginPairing', options);
    return { ok: true, pairing };
  }

  async function beginEnrollment(options = {}) {
    const enrollment = await publicConnectionRuntime.gatewayCall('beginEnrollment', options);
    await openBrowserPath(enrollment?.browserUrl, '/device');
    return { ok: true, enrollment };
  }

  async function openAccount() {
    const origin = browserOrigin();
    await openBrowserPath(new URL('/account', origin).href, '/account');
    return { ok: true };
  }

  function browserOrigin() {
    const raw = String(readGuiConfig().gatewayOrigin || '').trim();
    if (!raw) throw new Error('Rel.AI Cloud origin is unavailable.');
    const origin = new URL(raw);
    const localHttp = origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname);
    if (origin.protocol !== 'https:' && !localHttp) throw new Error('Rel.AI Cloud browser links must use HTTPS.');
    return origin;
  }

  async function openBrowserPath(value, expectedPath) {
    const origin = browserOrigin();
    const target = new URL(String(value || ''), origin);
    if (target.origin !== origin.origin || target.pathname !== expectedPath) throw new Error('Rel.AI Cloud returned an unexpected browser link.');
    await shell.openExternal(target.href);
  }

  function cancelPairing() {
    const status = publicConnectionRuntime.gatewayCall('cancelPairing');
    return { ok: true, gateway: safeGatewayDesktopStatus(status, readGuiConfig().gatewayOrigin) };
  }

  async function listDevices() {
    const devices = await publicConnectionRuntime.gatewayCall('listDevices');
    return { ok: true, devices: Array.isArray(devices) ? devices.map(safeGatewayDevice) : [] };
  }

  async function revokeDevice(deviceId) {
    const result = await publicConnectionRuntime.gatewayCall('revokeDevice', deviceId);
    return { ok: result?.ok === true, deviceId: String(result?.deviceId || deviceId), selfRevoked: result?.selfRevoked === true };
  }

  async function setMode(mode) {
    const current = readGuiConfig();
    saveLauncherConfig({
      connectionMode: mode, gatewayOrigin: current.gatewayOrigin, port: current.port, token: current.token,
      ngrokDomain: current.ngrokDomain, ngrokAuthtoken: current.ngrokAuthtoken
    });
    const status = await launchConfiguredDesktop({ restart: true });
    if (!status.serverRunning) throw new Error(status.error || 'Rel.AI connection mode could not be restarted.');
    return { ok: true, connectionMode: mode, status: statusForDashboard() };
  }

  async function getRecovery() {
    await gatewayDeviceIdentity.open();
    const principal = gatewayDeviceIdentity.principalState();
    if (!principal.principalId || !principal.recoverySecret) throw new Error('No paired Rel.AI recovery code is available on this device.');
    return { ok: true, recoveryCode: formatRecoveryCode(principal.principalId, principal.recoverySecret) };
  }

  async function ensureWizardCloudRuntime() {
    let current = {};
    try { current = readGuiConfig(); } catch {}
    saveLauncherConfig({
      connectionMode: 'cloud', gatewayOrigin: current.gatewayOrigin, port: current.port || 3333, token: current.token,
      ngrokDomain: current.ngrokDomain, ngrokAuthtoken: current.ngrokAuthtoken
    });
    const runtime = publicConnectionRuntime.snapshot();
    const status = await launchConfiguredDesktop({ restart: Boolean(isHttpServerListening() && runtime.mode !== 'cloud'), background: true });
    if (!status.serverRunning || publicConnectionRuntime.snapshot().mode !== 'cloud') throw new Error(status.error || 'Rel.AI Cloud could not be started.');
    return status;
  }

  async function startWizardCloudEnrollment(options = {}) { await ensureWizardCloudRuntime(); return beginEnrollment(options); }
  async function startWizardCloudPairing(options = {}) { await ensureWizardCloudRuntime(); return beginPairing(options); }
  async function recoverWizardCloudIdentity(recoveryCode) {
    const code = String(recoveryCode || '').trim();
    if (!code || code.length > 8192) throw new Error('A valid Rel.AI recovery code is required.');
    return startWizardCloudEnrollment({ recoveryCode: code });
  }

  async function createWizardDeviceLink() {
    await gatewayDeviceIdentity.open();
    const principal = gatewayDeviceIdentity.principalState();
    if (!principal.principalId) throw new Error('Pair this device with Rel.AI Cloud before creating a link code.');
    const result = await publicConnectionRuntime.gatewayCall('createDeviceLink');
    if (!result?.ok || !result.linkCode) throw new Error('A one-time device link code could not be created.');
    return { ok: true, linkCode: formatDeviceLinkCode(principal.principalId, result.linkCode), expiresAt: Number(result.expiresAt || 0) };
  }

  async function getUsage(month) {
    try {
      const usage = await publicConnectionRuntime.gatewayCall('requestUsage', month);
      return { ok: true, ...usage };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      if (/gateway is not connected|rel\.ai cloud is not connected/i.test(message)) return { ok: false, errorCode: 'GATEWAY_NOT_CONNECTED', error: 'Rel.AI Cloud is not connected.' };
      throw error;
    }
  }

  function applyStatus(status = {}) {
    const gateway = safeGatewayDesktopStatus(status, status.gatewayOrigin);
    const mcpUrl = gateway.gatewayOrigin ? buildMcpUrl(gateway.gatewayOrigin) : '';
    dashboardWindowManager.getWindow()?.webContents.send('desktop:gateway-status', gateway);
    if (gateway.state === 'connected') {
      setStatus({ connectionMode: 'cloud', gateway, tunnelStatus: 'running', mcpUrl, authenticationRequired: false, error: '', errorCode: '' }, { dashboard: false });
      return;
    }
    if (gateway.state === 'pairing_required' || gateway.state === 'pairing') {
      setStatus({ connectionMode: 'cloud', gateway, tunnelStatus: 'running', mcpUrl, authenticationRequired: true, error: '', errorCode: '' }, { dashboard: false });
      return;
    }
    if (gateway.state === 'device_update_required' || gateway.state === 'error') {
      setStatus(desktopStatusFailure(
        errorCodes.PUBLIC_ENDPOINT_FAILED,
        gateway.error || (gateway.state === 'device_update_required' ? 'Rel.AI Desktop must be updated for the gateway protocol.' : 'Rel.AI gateway connection failed.'),
        { connectionMode: 'cloud', gateway, serverRunning: true, tunnelStatus: 'failed', mcpUrl, authenticationRequired: false }
      ), { dashboard: false });
      return;
    }
    setStatus({
      connectionMode: 'cloud', gateway, tunnelStatus: 'connecting', mcpUrl,
      authenticationRequired: gatewayAuthorizationRequired(gateway), error: '', errorCode: ''
    }, { dashboard: false });
  }

  return {
    statusForDashboard, beginPairing, beginEnrollment, openAccount, cancelPairing, listDevices, revokeDevice, setMode, getRecovery,
    startWizardCloudEnrollment, startWizardCloudPairing, recoverWizardCloudIdentity,
    getWizardCloudStatus: statusForDashboard, cancelWizardCloudPairing: cancelPairing, getWizardRecoveryCode: getRecovery,
    createWizardDeviceLink, getUsage, applyStatus
  };
}

function safeGatewayDevice(device = {}) {
  return {
    deviceId: String(device.deviceId || ''), displayName: String(device.displayName || ''), appVersion: String(device.appVersion || ''),
    protocolVersion: Number(device.protocolVersion || 0), mcpProtocolVersion: String(device.mcpProtocolVersion || ''),
    capabilities: device.capabilities && typeof device.capabilities === 'object' ? { ...device.capabilities } : {},
    lastSeenAt: device.lastSeenAt == null ? null : Number(device.lastSeenAt), revokedAt: device.revokedAt == null ? null : Number(device.revokedAt)
  };
}

export { createGatewayActions };
