import { fetchJson } from '../../api.js';
import { toast } from '../../components/toast.js';
import { pillHtml } from '../../components/pill.js';
import { copyText } from '../../clipboard.js';
import { get as getStore } from '../../store.js';
import { connectionLayerViews, connectionStateFor, connectionSummary, isMcpAuthenticationReady } from '../../connection-state.js';
import { mountDesktopConnection } from './desktop-connection.js';
import { mountCloudGateway, updateCloudGatewayLiveState } from './cloud-gateway.js';
import { clientCapabilityViews } from '../../task-identity.js';
import { createChatGptSetupGuide } from './connection-guidance.js';
import { esc as escapeHtml } from '../../utils.js';

const connectorPayloads = new WeakMap();

export function mountConnector(container) {
  container.innerHTML = '<div class="connection-loading">Loading connection details…</div>';
  return loadConnector(container).catch(error => {
    container.innerHTML = `<div class="empty">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  });
}

async function loadConnector(container) {
  const payload = await fetchJson('/api/connection');
  container.innerHTML = '<div class="section connection-page"></div>';
  const page = container.querySelector('.connection-page');
  if (!payload || payload.ok === false) {
    page.insertAdjacentHTML('beforeend', '<div class="empty">Connection details could not be loaded.</div>');
    return;
  }

  connectorPayloads.set(container, payload);
  const dashboardState = getStore();
  let gatewayModel = null;
  if (window.relaiDesktop?.getGatewayStatus) {
    try { gatewayModel = await window.relaiDesktop.getGatewayStatus(); } catch {}
  }
  const connectionMode = String(gatewayModel?.connectionMode || dashboardState.desktopStatus?.connectionMode || 'direct');
  const state = connectionViewState(payload, dashboardState);
  state.mode = connectionMode;
  const effectivePayload = connectorPayload(payload, dashboardState, gatewayModel);
  page.append(
    summaryCard(effectivePayload, state),
    supportRow(),
    layerDisclosure(state)
  );
  if (connectionMode !== 'cloud') {
    page.append(
      setupGuideRegion(effectivePayload, state),
      connectionDetails(effectivePayload, state, dashboardState)
    );
  }

  const controls = document.createElement('section');
  controls.id = 'connectionControls';
  controls.className = 'connection-controls-section';
  page.appendChild(controls);
  const cloudControls = document.createElement('div');
  cloudControls.className = 'cloud-gateway-controls';
  controls.appendChild(cloudControls);
  const cloudModel = await mountCloudGateway(cloudControls);
  if (cloudModel?.connectionMode === 'direct') {
    const directControls = document.createElement('div');
    directControls.className = 'direct-connection-controls';
    controls.appendChild(directControls);
    await mountDesktopConnection(directControls);
  }
}

function connectionViewState(payload, dashboardState = {}) {
  const mcpConnection = payload.mcpConnection || dashboardState.mcpConnection || {};
  const mcpAuthentication = payload.mcpAuthentication || dashboardState.mcpAuthentication || {};
  return connectionStateFor({ ...dashboardState, mcpConnection, mcpAuthentication });
}

export function updateConnectorLiveState(container, dashboardState = {}) {
  const page = container.querySelector('.connection-page');
  const payload = connectorPayloads.get(container);
  if (!page || !payload) return false;
  const state = connectionViewState(payload, dashboardState);
  const effectivePayload = connectorPayload(payload, dashboardState, {
    connectionMode: dashboardState.desktopStatus?.connectionMode,
    gateway: dashboardState.desktopStatus?.gateway
  });
  replaceRegion(page, '.connection-summary-card', summaryCard(effectivePayload, state));
  replaceRegion(page, '.connection-support-row', supportRow());
  replaceRegion(page, '.connection-layer-disclosure', layerDisclosure(state), { preserveOpen: true });
  if (state.mode !== 'cloud') {
    replaceRegion(page, '.connection-guide-region', setupGuideRegion(effectivePayload, state));
    replaceRegion(page, '.connector-technical-details', connectionDetails(effectivePayload, state, dashboardState), { preserveOpen: true });
  }
  updateCloudGatewayLiveState(container, dashboardState.desktopStatus?.gateway || {});
  return true;
}

function connectorPayload(payload, dashboardState = {}, gatewayModel = null) {
  const mode = String(gatewayModel?.connectionMode || dashboardState.desktopStatus?.connectionMode || 'direct');
  if (mode !== 'cloud') return payload;
  const gatewayOrigin = String(gatewayModel?.gateway?.gatewayOrigin || dashboardState.desktopStatus?.gateway?.gatewayOrigin || '');
  return {
    ...payload,
    chatgptMcpUrl: String(dashboardState.desktopStatus?.mcpUrl || (gatewayOrigin ? gatewayOrigin.replace(/\/$/, '') + '/mcp' : '')),
    chatgptHealthUrl: '',
    chatgptAuthMode: 'Rel.AI Cloud pairing',
    nextSteps: []
  };
}

function replaceRegion(page, selector, next, options = {}) {
  const current = page.querySelector(selector);
  if (!current) return;
  if (options.preserveOpen && current instanceof HTMLDetailsElement && next instanceof HTMLDetailsElement) next.open = current.open;
  if (!current.isEqualNode(next)) current.replaceWith(next);
}

function summaryCard(payload, state) {
  const summary = connectionSummary(state);
  const card = document.createElement('section');
  card.className = `card connection-summary-card ${summary.tone}`;
  card.innerHTML = `
    <div class="card-head"><h3>ChatGPT connection</h3>${pillHtml(summary.label, summary.tone)}</div>
    <div class="card-body connection-status-body">
      <div class="connection-status-copy">
        <h2>${escapeHtml(summary.title)}</h2>
        <p>${escapeHtml(summary.message)}</p>
      </div>
      <div class="connection-field">
        <span class="field-caption">MCP endpoint</span>
        <div class="connection-endpoint-row">
          <code class="connector-endpoint">${escapeHtml(payload.chatgptMcpUrl || 'Waiting for the secure endpoint')}</code>
          <button class="secondary" type="button" data-copy-endpoint ${payload.chatgptMcpUrl ? '' : 'disabled'}>Copy endpoint</button>
        </div>
      </div>
      <div class="connection-primary-action">${primaryActionHtml(payload, state)}</div>
    </div>`;
  card.querySelector('[data-copy-endpoint]')?.addEventListener('click', () => copyValue(payload.chatgptMcpUrl, 'MCP endpoint copied.'));
  card.querySelector('[data-scroll-tunnel]')?.addEventListener('click', () => scrollToControl('tunnelSettings'));
  card.querySelector('[data-scroll-approval]')?.addEventListener('click', () => scrollToControl('approvalTokenSettings'));
  card.querySelector('[data-scroll-controls]')?.addEventListener('click', () => scrollToControl('connectionControls'));
  return card;
}

export function connectionPrimaryAction(payload = {}, state = {}) {
  if (state.mode === 'cloud') {
    const cloudSummary = connectionSummary(state);
    if (!isMcpAuthenticationReady(state) || cloudSummary.tone === 'bad' || cloudSummary.tone === 'warn') {
      return { kind: 'control', target: 'connectionControls', label: 'Review Cloud connection' };
    }
    return { kind: 'route', href: '#tasks', label: 'Open work sessions' };
  }
  if (!payload.chatgptMcpUrl || state.publicEndpoint?.status !== 'available') {
    return { kind: 'control', target: 'tunnelSettings', label: 'Configure tunnel' };
  }
  if (!isMcpAuthenticationReady(state)) {
    return { kind: 'control', target: 'approvalTokenSettings', label: 'Review approval token' };
  }
  const summary = connectionSummary(state);
  if (summary.tone === 'bad' || summary.tone === 'warn') {
    return { kind: 'route', href: '#diagnostics', label: 'Open diagnostics' };
  }
  return { kind: 'route', href: '#tasks', label: 'Open work sessions' };
}

function primaryActionHtml(payload, state) {
  const action = connectionPrimaryAction(payload, state);
  if (action.kind === 'control') {
    const target = action.target === 'tunnelSettings' ? 'tunnel' : action.target === 'connectionControls' ? 'controls' : 'approval';
    return `<button class="primary" type="button" data-scroll-${target}>${escapeHtml(action.label)}</button>`;
  }
  return `<a class="buttonlike primary" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`;
}

function supportRow() {
  const row = document.createElement('div');
  row.className = 'connection-support-row';
  row.innerHTML = `
    <button class="secondary compact-button" type="button" data-refresh-connection>Refresh status</button>
    <a class="buttonlike secondary compact-button" href="#diagnostics">Diagnostics</a>`;
  row.querySelector('[data-refresh-connection]').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('relai:dashboard-refresh'));
    toast('Refreshing connection status…', { variant: 'info' });
  });
  return row;
}

function layerDisclosure(state) {
  const details = document.createElement('details');
  const summary = connectionSummary(state);
  details.className = 'card connector-details connection-layer-disclosure';
  details.open = summary.tone !== 'ok' && summary.tone !== 'good';
  details.innerHTML = `
    <summary class="connector-details-summary">
      <span><strong>Connection layers</strong><small>Endpoint, authorization, client session, and tool synchronization</small></span>
      <span aria-hidden="true">›</span>
    </summary>`;
  const path = document.createElement('div');
  path.className = 'connection-path';
  for (const layer of connectionLayerViews(state)) path.appendChild(layerCard(layer));
  details.appendChild(path);
  return details;
}

function layerCard(layer) {
  const card = document.createElement('article');
  card.className = `connection-path-step ${layer.tone}`;
  card.dataset.connectionLayer = layer.key;
  card.innerHTML = `
    <div class="connection-layer-card-head">
      <span class="connection-layer-dot" aria-hidden="true"></span>
      <div><h4>${escapeHtml(layer.title)}</h4><span class="connection-layer-state ${layer.tone}">${escapeHtml(layer.label)}</span></div>
    </div>
    <p>${escapeHtml(layer.description)}</p>`;
  return card;
}

export function connectionGuideMode(state = {}) {
  if (isMcpAuthenticationReady(state)) return null;
  const authorization = String(state.chatgptReadiness?.status || '');
  const client = String(state.mcpClient?.status || '');
  if (authorization === 'authentication_required' || authorization === 'authentication_failed' || client === 'reauthentication_required') {
    return 'reconnect';
  }
  return 'create';
}

function setupGuideRegion(payload, state) {
  const region = document.createElement('div');
  region.className = 'connection-guide-region';
  const mode = connectionGuideMode(state);
  if (!mode) return region;

  const card = document.createElement('section');
  card.className = 'card connection-guide-card';
  card.innerHTML = `<div class="card-head"><h3>${mode === 'reconnect' ? 'Reconnect ChatGPT' : 'Connect ChatGPT'}</h3><span class="section-action">guided setup</span></div>`;
  const body = document.createElement('div');
  body.className = 'card-body';
  body.appendChild(createChatGptSetupGuide({
    mode,
    endpointAvailable: Boolean(payload.chatgptMcpUrl),
    developerModeRequired: true,
    compact: true
  }));
  card.appendChild(body);
  region.appendChild(card);
  return region;
}

function connectionDetails(payload, state, dashboardState = {}) {
  const details = document.createElement('details');
  details.className = 'card connector-details connector-technical-details';
  const mcpConnection = dashboardState.mcpConnection || payload.mcpConnection || {};
  const capability = clientCapabilityViews({ ...dashboardState, mcpConnection })[0];
  details.innerHTML = `
    <summary class="connector-details-summary">
      <span><strong>Connection details</strong><small>Authentication, observed client, and synchronized tool state</small></span>
      <span aria-hidden="true">›</span>
    </summary>
    <div class="card-body connection-facts">
      <div class="connection-fact"><span class="connection-fact-label">Authentication</span><span>${escapeHtml(isMcpAuthenticationReady(state) ? 'Ready' : 'Approval required')}</span></div>
      <div class="connection-fact"><span class="connection-fact-label">MCP activity</span><span>${escapeHtml(mcpConnection.activityStatus || mcpConnection.status || 'unknown')}</span></div>
      <div class="connection-fact"><span class="connection-fact-label">Execution mode</span><span>${escapeHtml(capability.executionLabel.replace('Execution mode: ', ''))}</span></div>
      <div class="connection-fact"><span class="connection-fact-label">Native MCP Tasks</span><span>${escapeHtml(capability.capabilityLabel.replace('Native MCP Tasks: ', ''))}</span></div>
      <div class="connection-fact"><span class="connection-fact-label">Observed client</span><span>${escapeHtml(capability.clientLabel)}</span></div>
      <div class="connection-fact"><span class="connection-fact-label">Active requests</span><span>${escapeHtml(String(mcpConnection.activeRequestCount || 0))}</span></div>
      <div class="connection-fact"><span class="connection-fact-label">Visible tools</span><span>${escapeHtml(String(mcpConnection.externallyVisibleToolCount || 0))}</span></div>
      <div class="connection-fact"><span class="connection-fact-label">Tool manifest</span><code>${escapeHtml(mcpConnection.toolManifestVersion || '—')}</code></div>
    </div>`;
  return details;
}

function scrollToControl(id) {
  const element = document.getElementById(id) || document.getElementById('connectionControls');
  element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  element?.querySelector('input, button')?.focus({ preventScroll: true });
}

async function copyValue(value, message) {
  if (!value) {
    toast('Nothing to copy yet.', { variant: 'warn' });
    return;
  }
  try {
    await copyText(value);
    toast(message, { variant: 'success' });
  } catch {
    toast('Clipboard access failed.', { variant: 'error' });
  }
}
