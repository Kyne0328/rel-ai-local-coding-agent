import { toast } from '../../components/toast.js';
import { confirmAction } from '../../components/confirm-dialog.js';
import { requestDashboardRefresh } from '../../api.js';
import { esc as escapeHtml } from '../../utils.js';

let removeCloudUpdateListener = null;

export async function mountCloudGateway(container) {
  removeCloudUpdateListener?.();
  removeCloudUpdateListener = null;
  container.innerHTML = '<div class="settings-loading">Loading Rel.AI Cloud…</div>';
  const desktop = window.relaiDesktop;
  if (!hasGatewayBridge(desktop)) {
    container.innerHTML = '<div class="empty">Rel.AI Cloud controls are available inside the installed desktop app.</div>';
    container.dataset.connectionMode = 'browser';
    return { connectionMode: 'browser', gateway: null };
  }
  if (desktop.onUpdateStatus) {
    const unsubscribe = desktop.onUpdateStatus(status => updateCloudUpdateImpact(container, status));
    if (typeof unsubscribe === 'function') removeCloudUpdateListener = unsubscribe;
  }
  return loadCloudGateway(container, desktop);
}

export function updateCloudGatewayLiveState(container, gateway = {}) {
  const root = container.querySelector('[data-cloud-gateway]');
  const region = root?.querySelector('[data-cloud-status-region]');
  if (!root || !region) return false;
  const mode = root.dataset.connectionMode || 'cloud';
  const previousState = root.dataset.gatewayState || '';
  const next = safeGateway(gateway);
  const nextState = effectiveGatewayState(next);
  region.innerHTML = gatewayStatusHtml(mode, next);
  root.dataset.gatewayState = nextState;
  bindActions(root, { connectionMode: mode, gateway: next, devices: [] });
  if (mode === 'cloud' && next.principalPaired && previousState !== nextState) {
    void refreshDeviceRegion(root, next);
  }
  return true;
}

async function loadCloudGateway(container, desktop) {
  try {
    const response = await desktop.getGatewayStatus();
    const connectionMode = response?.connectionMode === 'direct' ? 'direct' : 'cloud';
    const gateway = safeGateway(response?.gateway || {});
    const devices = connectionMode === 'cloud' && gateway.principalPaired
      ? await safeDeviceList(desktop)
      : [];
    const updateStatus = desktop.getUpdateStatus ? await desktop.getUpdateStatus().catch(() => null) : null;
    render(container, { connectionMode, gateway, devices, updateStatus });
    return { connectionMode, gateway, devices, updateStatus };
  } catch (error) {
    container.innerHTML = `<div class="empty">Rel.AI Cloud status could not be loaded: ${escapeHtml(messageOf(error))}</div>`;
    container.dataset.connectionMode = 'error';
    return { connectionMode: 'error', gateway: null };
  }
}

function render(container, model) {
  container.innerHTML = '';
  container.dataset.connectionMode = model.connectionMode;
  const root = document.createElement('section');
  root.className = 'cloud-gateway-settings';
  root.dataset.cloudGateway = '';
  root.dataset.connectionMode = model.connectionMode;
  root.dataset.gatewayState = effectiveGatewayState(model.gateway);
  root.innerHTML = `
    <div class="settings-header cloud-gateway-heading">
      <div><h3>Rel.AI Cloud</h3><p>Connect the shared Rel.AI app in ChatGPT while repository access and development work stay on this computer.</p></div>
      <span class="status-pill ${gatewayTone(model.connectionMode, model.gateway)}">${escapeHtml(gatewayLabel(model.connectionMode, model.gateway))}</span>
    </div>
    <section class="card cloud-gateway-card">
      <div class="card-body cloud-gateway-stack">
        <div data-cloud-status-region aria-live="polite">${gatewayStatusHtml(model.connectionMode, model.gateway)}</div>
        <div data-cloud-update-impact>${updateImpactHtml(model.connectionMode, model.updateStatus)}</div>
        <div data-cloud-actions></div>
        <div data-cloud-devices>${devicesHtml(model.devices, model.gateway)}</div>
      </div>
    </section>`;
  container.appendChild(root);
  bindActions(root, model);
}

function bindActions(root, model) {
  const container = root.parentElement;
  if (!container) return;
  bindPairingCopy(root, model.gateway);
  const actions = root.querySelector('[data-cloud-actions]');
  if (!actions) return;
  actions.innerHTML = actionHtml(model.connectionMode, model.gateway);
  actions.querySelector('[data-cloud-enroll]')?.addEventListener('click', event => runButton(event.currentTarget, 'Opening browser…', async () => {
    const result = await window.relaiDesktop.beginGatewayEnrollment();
    toast('Rel.AI account sign-in opened in your browser.', { variant: 'success' });
    await loadCloudGateway(container, window.relaiDesktop);
    return result;
  }));
  actions.querySelector('[data-cloud-pair-cancel]')?.addEventListener('click', event => runButton(event.currentTarget, 'Cancelling…', async () => {
    await window.relaiDesktop.cancelGatewayPairing();
    await loadCloudGateway(container, window.relaiDesktop);
  }));
  actions.querySelector('[data-cloud-mode]')?.addEventListener('click', event => runButton(event.currentTarget, 'Switching connection…', async () => {
    const mode = event.currentTarget.dataset.cloudMode;
    await window.relaiDesktop.setGatewayMode(mode);
    toast(mode === 'cloud' ? 'Rel.AI Cloud enabled.' : 'Direct connection enabled.', { variant: 'success' });
    requestDashboardRefresh({ structural: true });
  }));
  actions.querySelector('[data-cloud-account]')?.addEventListener('click', event => runButton(event.currentTarget, 'Opening account…', async () => window.relaiDesktop.openGatewayAccount()));
  actions.querySelector('[data-cloud-recovery]')?.addEventListener('click', event => showRecovery(root, event.currentTarget));
  actions.querySelector('[data-cloud-refresh-devices]')?.addEventListener('click', event => runButton(event.currentTarget, 'Refreshing devices…', async () => {
    await refreshDeviceRegion(root, model.gateway);
    toast('Device list refreshed.', { variant: 'success' });
  }));
  bindDeviceActions(root);
}

function bindPairingCopy(root, gateway) {
  const button = root.querySelector('[data-copy-pairing]');
  const code = String(gateway?.pairing?.code || '');
  if (!button || !code || button.dataset.cloudBound === '1') return;
  button.dataset.cloudBound = '1';
  button.addEventListener('click', async () => {
    const label = button.querySelector('span');
    button.disabled = true;
    if (label) label.textContent = 'Copying…';
    try {
      await window.relaiDesktop.copyText(code);
      if (label) label.textContent = 'Copied';
      toast('Pairing code copied.', { variant: 'success' });
    } catch (error) {
      if (label) label.textContent = 'Copy code';
      toast(messageOf(error), { variant: 'error' });
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        window.setTimeout(() => { if (label?.isConnected) label.textContent = 'Copy code'; }, 1200);
      }
    }
  });
}

function updateCloudUpdateImpact(container, updateStatus = {}) {
  const root = container.querySelector('[data-cloud-gateway]');
  const region = root?.querySelector('[data-cloud-update-impact]');
  if (!root || !region) return false;
  region.innerHTML = updateImpactHtml(root.dataset.connectionMode || 'cloud', updateStatus);
  return true;
}

function updateImpactHtml(mode, updateStatus = {}) {
  if (mode !== 'cloud') return '';
  const synchronization = updateStatus?.updateSynchronization;
  if (!synchronization || updateStatus?.state === 'up_to_date') return '';
  if (synchronization.status === 'tool_refresh_required') {
    return '<div class="connection-notice warn cloud-update-impact"><strong>This Rel.AI update changes the public MCP tools.</strong><br>After installing the update, refresh the existing Rel.AI tools in ChatGPT. Do not revoke OAuth or recreate the app.</div>';
  }
  if (synchronization.status === 'device_update_required') {
    return '<div class="connection-notice warn cloud-update-impact"><strong>This Rel.AI update changes the device protocol.</strong><br>Install the normal Rel.AI Desktop update when ready. This update notice does not mean ChatGPT authentication has expired.</div>';
  }
  return '';
}

function actionHtml(mode, gateway) {
  if (mode === 'direct') {
    return '<div class="cloud-gateway-actions"><button type="button" class="primary" data-cloud-mode="cloud">Switch to Rel.AI Cloud</button><span class="muted">Direct connection remains available below as the current fallback.</span></div>';
  }
  const state = effectiveGatewayState(gateway);
  if (state === 'pairing') {
    return '<div class="cloud-gateway-actions"><button type="button" class="secondary" data-cloud-pair-cancel>Cancel pairing</button></div>';
  }
  if (state === 'pairing_required' || state === 'offline' || state === 'error') {
    return '<div class="cloud-gateway-actions"><button type="button" class="primary" data-cloud-enroll>Sign in to Rel.AI</button><details class="cloud-gateway-fallback"><summary>Advanced fallback</summary><button type="button" class="secondary compact-button" data-cloud-mode="direct">Use Direct connection</button></details></div>';
  }
  return '<div class="cloud-gateway-actions"><button type="button" class="secondary" data-cloud-account>Manage Rel.AI account</button><button type="button" class="secondary" data-cloud-refresh-devices>Refresh devices</button><details class="cloud-gateway-fallback"><summary>Legacy and Direct options</summary><button type="button" class="secondary compact-button" data-cloud-recovery>Show legacy recovery code</button><button type="button" class="secondary compact-button" data-cloud-mode="direct">Use Direct connection</button></details></div>';
}

function gatewayStatusHtml(mode, gateway) {
  if (mode === 'direct') {
    return '<div class="cloud-gateway-state"><strong>Direct connection is active</strong><p>Rel.AI Cloud is available as the recommended shared-app connection when you are ready to switch.</p></div>';
  }
  const state = effectiveGatewayState(gateway);
  if (state === 'pairing_required') {
    return '<div class="cloud-gateway-state"><strong>Sign in to Rel.AI</strong><p>Use your Rel.AI account to approve this computer. Adding another PC uses the same account and does not require access to an already connected device.</p></div>';
  }
  if (state === 'pairing') {
    const rawCode = String(gateway.pairing?.code || '');
    if (!rawCode) return `<div class="cloud-gateway-state cloud-pairing-state"><strong>Waiting for account approval</strong><p>${escapeHtml(expiryLabel(gateway.pairing?.expiresAt))}. Finish signing in and approve this computer in the Rel.AI browser window.</p></div>`;
    const code = escapeHtml(rawCode);
    const expires = expiryLabel(gateway.pairing?.expiresAt);
    return `<div class="cloud-gateway-state cloud-pairing-state"><span class="field-caption">Legacy pairing code</span><button type="button" class="cloud-pairing-copy" data-copy-pairing aria-label="Copy legacy pairing code ${code}"><code class="cloud-pairing-code">${code}</code><span>Copy code</span></button><p>${escapeHtml(expires)}. This code is only for legacy migration and recovery.</p></div>`;
  }
  if (state === 'tool_refresh_required') {
    return '<div class="cloud-gateway-state warn"><strong>ChatGPT tool refresh recommended</strong><p>The Rel.AI schema changed. Refresh the existing Rel.AI app tools in ChatGPT; do not reconnect credentials or recreate the app.</p></div>';
  }
  if (state === 'device_update_required') {
    return '<div class="cloud-gateway-state warn"><strong>Rel.AI Desktop update required</strong><p>This device protocol is older than the gateway minimum. Update Rel.AI Desktop; ChatGPT authorization can stay as-is.</p></div>';
  }
  if (state === 'reauthentication_required') {
    return '<div class="cloud-gateway-state warn"><strong>Reconnect ChatGPT</strong><p>The Rel.AI authorization grant expired or was revoked. Reauthorize the existing Rel.AI app; a tool refresh is a separate action.</p></div>';
  }
  if (state === 'connected') {
    const device = gateway.deviceId ? `Device ${shortId(gateway.deviceId)}` : 'This device';
    const last = gateway.lastConnectedAt ? timeLabel(gateway.lastConnectedAt) : 'connected now';
    return `<div class="cloud-gateway-state good"><strong>Rel.AI Cloud connected</strong><p>${escapeHtml(device)} · ${escapeHtml(last)}. This computer is linked to your Rel.AI account; add other PCs by installing Rel.AI and signing in with the same account.</p></div>`;
  }
  if (state === 'connecting' || state === 'authenticating') {
    return '<div class="cloud-gateway-state"><strong>Connecting to Rel.AI Cloud</strong><p>The local service stays available while the outbound device connection is restored.</p></div>';
  }
  if (state === 'error') {
    return `<div class="cloud-gateway-state bad"><strong>Rel.AI Cloud needs attention</strong><p>${escapeHtml(gateway.error || 'The gateway connection could not be established.')}</p></div>`;
  }
  return '<div class="cloud-gateway-state"><strong>Rel.AI Cloud offline</strong><p>The local service is still available. Rel.AI will reconnect the outbound gateway session automatically.</p></div>';
}

function devicesHtml(devices, gateway) {
  if (!gateway.principalPaired) return '';
  if (!devices.length) return '<div class="cloud-device-section"><div class="field-caption">Paired devices</div><p class="muted">No device list is available yet.</p></div>';
  return `<div class="cloud-device-section"><div class="cloud-device-heading"><div><span class="field-caption">Account devices</span><p class="muted">Every approved computer has its own device key. Use Manage Rel.AI account to revoke lost devices or choose routing preferences when workspace names overlap.</p></div><span>${devices.length} device${devices.length === 1 ? '' : 's'}</span></div><div class="cloud-device-list">${devices.map(deviceHtml).join('')}</div></div>`;
}

function deviceHtml(device) {
  const current = device.deviceId && device.deviceId === safeCurrentDeviceId();
  const storedLabel = String(device.displayName || '').trim();
  const genericLabel = !storedLabel || storedLabel === 'Rel.AI MCP';
  const label = genericLabel ? (current ? 'This device' : `Device ${shortId(device.deviceId)}`) : storedLabel;
  const seen = device.lastSeenAt ? timeLabel(device.lastSeenAt) : 'Not seen yet';
  const revoked = device.revokedAt != null;
  const action = current ? 'Disconnect' : 'Revoke';
  return `<article class="cloud-device-row" data-device-id="${escapeHtml(device.deviceId)}"><div class="cloud-device-copy"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(seen)}${current ? ' · this device' : ''}${revoked ? ' · revoked' : ''}</span></div><button type="button" class="${current ? 'danger' : 'secondary'} compact-button" data-cloud-revoke="${escapeHtml(device.deviceId)}" data-cloud-current="${current ? 'true' : 'false'}" ${revoked ? 'disabled' : ''}>${action}</button></article>`;
}

let currentDeviceId = '';
function safeCurrentDeviceId() { return currentDeviceId; }

async function refreshDeviceRegion(root, gateway) {
  const region = root.querySelector('[data-cloud-devices]');
  if (!region || !window.relaiDesktop?.getGatewayDevices) return;
  const devices = await safeDeviceList(window.relaiDesktop);
  if (!root.isConnected) return;
  region.innerHTML = devicesHtml(devices, gateway);
  bindDeviceActions(root);
  return devices;
}

async function safeDeviceList(desktop) {
  try {
    const response = await desktop.getGatewayDevices();
    const devices = Array.isArray(response?.devices) ? response.devices.map(safeDevice) : [];
    const status = await desktop.getGatewayStatus();
    currentDeviceId = String(status?.gateway?.deviceId || '');
    return devices;
  } catch {
    return [];
  }
}

function bindDeviceActions(root) {
  const container = root.parentElement;
  if (!container) return;
  root.querySelectorAll('[data-cloud-revoke]').forEach(button => {
    if (button.dataset.cloudBound === '1') return;
    button.dataset.cloudBound = '1';
    button.addEventListener('click', event => revokeDevice(container, event.currentTarget));
  });
}

async function revokeDevice(container, button) {
  const deviceId = String(button.dataset.cloudRevoke || '');
  if (!deviceId) return;
  const current = button.dataset.cloudCurrent === 'true';
  const label = button.closest('.cloud-device-row')?.querySelector('strong')?.textContent || 'this device';
  const confirmed = await confirmAction({
    title: current ? 'Disconnect this device?' : 'Revoke device?',
    message: current ? 'Disconnect this computer from Rel.AI Cloud?' : `Revoke ${label}?`,
    detail: current
      ? 'ChatGPT will lose access to this computer until you sign in and approve it again. Local workspaces and files will not be deleted.'
      : 'This device will lose access to the shared Rel.AI connection. Its local workspaces and files will not be deleted.',
    confirmLabel: current ? 'Disconnect device' : 'Revoke device',
    danger: true
  });
  if (!confirmed) return;
  await runButton(button, current ? 'Disconnecting…' : 'Revoking…', async () => {
    const result = await window.relaiDesktop.revokeGatewayDevice(deviceId);
    if (!result?.ok) throw new Error('The device could not be revoked.');
    toast(current ? 'This device was disconnected.' : 'Device revoked.', { variant: 'success' });
    await loadCloudGateway(container, window.relaiDesktop);
  });
}

async function showRecovery(root, button) {
  await runButton(button, 'Reading recovery code…', async () => {
    const response = await window.relaiDesktop.getGatewayRecovery();
    const recoveryCode = String(response?.recoveryCode || '');
    if (!recoveryCode) throw new Error('No recovery code is available.');
    let panel = root.querySelector('[data-cloud-recovery-panel]');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'connection-notice warn cloud-recovery-panel';
      panel.dataset.cloudRecoveryPanel = '';
      root.querySelector('.cloud-gateway-stack')?.appendChild(panel);
    }
    panel.innerHTML = '<strong>Legacy recovery code</strong><p>This is retained only for migrating older Rel.AI identities. Account-based devices should add or replace computers by signing in to the same Rel.AI account.</p><div class="connection-endpoint-row"><code class="connector-endpoint" data-recovery-code></code><button type="button" class="secondary" data-copy-recovery>Copy code</button></div>';
    panel.querySelector('[data-recovery-code]').textContent = recoveryCode;
    panel.querySelector('[data-copy-recovery]').addEventListener('click', async () => {
      await window.relaiDesktop.copyText(recoveryCode);
      toast('Recovery code copied.', { variant: 'success' });
    });
  });
}

async function runButton(button, loadingLabel, action) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = loadingLabel;
  try {
    return await action();
  } catch (error) {
    toast(messageOf(error), { variant: 'error' });
    return null;
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function hasGatewayBridge(desktop) {
  return Boolean(desktop?.getGatewayStatus && desktop?.beginGatewayEnrollment && desktop?.openGatewayAccount && desktop?.cancelGatewayPairing && desktop?.getGatewayDevices && desktop?.revokeGatewayDevice && desktop?.setGatewayMode && desktop?.getGatewayRecovery);
}

function safeGateway(value = {}) {
  const pairing = value.pairing && typeof value.pairing === 'object'
    ? {
        pairingId: String(value.pairing.pairingId || ''),
        enrollmentId: String(value.pairing.enrollmentId || ''),
        browserUrl: String(value.pairing.browserUrl || ''),
        code: String(value.pairing.code || ''),
        expiresAt: Number(value.pairing.expiresAt || 0) || null
      }
    : null;
  return {
    state: String(value.state || 'offline'),
    schemaStatus: String(value.schemaStatus || ''),
    principalPaired: value.principalPaired === true,
    deviceId: String(value.deviceId || ''),
    pairing,
    lastConnectedAt: Number(value.lastConnectedAt || 0) || null,
    reconnectAttempt: Math.max(0, Number(value.reconnectAttempt || 0)),
    error: String(value.error || '')
  };
}

function safeDevice(value = {}) {
  return {
    deviceId: String(value.deviceId || ''),
    displayName: String(value.displayName || ''),
    appVersion: String(value.appVersion || ''),
    protocolVersion: Number(value.protocolVersion || 0),
    mcpProtocolVersion: String(value.mcpProtocolVersion || ''),
    lastSeenAt: value.lastSeenAt == null ? null : Number(value.lastSeenAt),
    revokedAt: value.revokedAt == null ? null : Number(value.revokedAt)
  };
}

function effectiveGatewayState(gateway) {
  if (gateway.schemaStatus === 'tool_refresh_required') return 'tool_refresh_required';
  if (gateway.schemaStatus === 'device_update_required') return 'device_update_required';
  if (gateway.schemaStatus === 'reauthentication_required') return 'reauthentication_required';
  return String(gateway.state || 'offline');
}

function gatewayTone(mode, gateway) {
  if (mode === 'direct') return 'warn';
  const state = effectiveGatewayState(gateway);
  if (state === 'connected') return 'ok';
  if (state === 'pairing' || state === 'connecting' || state === 'authenticating') return 'working';
  if (state === 'error') return 'bad';
  return 'warn';
}

function gatewayLabel(mode, gateway) {
  if (mode === 'direct') return 'Direct active';
  const state = effectiveGatewayState(gateway);
  if (state === 'connected') return 'Connected';
  if (state === 'pairing') return 'Pairing';
  if (state === 'pairing_required') return 'Not paired';
  if (state === 'tool_refresh_required') return 'Tool refresh';
  if (state === 'device_update_required') return 'Update required';
  if (state === 'reauthentication_required') return 'Reconnect required';
  if (state === 'connecting' || state === 'authenticating') return 'Connecting';
  if (state === 'error') return 'Needs attention';
  return 'Offline';
}

function expiryLabel(expiresAt) {
  const value = Number(expiresAt || 0);
  if (!value) return 'Short-lived code';
  const seconds = Math.max(0, Math.ceil((value - Date.now()) / 1000));
  if (seconds < 60) return `Expires in ${seconds}s`;
  return `Expires in ${Math.ceil(seconds / 60)}m`;
}

function timeLabel(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return 'Not connected yet';
  try { return new Date(timestamp).toLocaleString(); } catch { return 'Recently connected'; }
}

function shortId(value) {
  const text = String(value || '');
  return text.length > 12 ? `${text.slice(0, 8)}…${text.slice(-4)}` : text;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Rel.AI Cloud action failed.');
}
