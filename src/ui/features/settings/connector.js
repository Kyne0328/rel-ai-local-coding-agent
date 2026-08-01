import { fetchJson, postJson } from '../../api.js';
import { toast } from '../../components/toast.js';
import { pillHtml } from '../../components/pill.js';
import { copyText } from '../../clipboard.js';
import { get as getStore } from '../../store.js';
import { connectionLayerViews, connectionStateFor, connectionSummary, isMcpAuthenticationReady } from '../../connection-state.js';
import { mountDesktopConnection } from './desktop-connection.js';
import { esc as escapeHtml } from '../../utils.js';

export function mountConnector(container) {
  container.innerHTML = '<div class="connection-loading">Loading connection details…</div>';
  return loadConnector(container).catch(error => {
    container.innerHTML = `<div class="empty">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  });
}

async function loadConnector(container) {
  const payload = await fetchJson('/api/connection');
  container.innerHTML = '<div class="section connection-page"></div>';
  if (!payload || payload.ok === false) {
    container.querySelector('.section').insertAdjacentHTML('beforeend', '<div class="empty">Failed to load connection details.</div>');
    return;
  }

  const dashboardState = getStore();
  const mcpConnection = payload.mcpConnection || dashboardState.mcpConnection || {};
  const mcpAuthentication = payload.mcpAuthentication || dashboardState.mcpAuthentication || {};
  const state = connectionStateFor({ ...dashboardState, mcpConnection, mcpAuthentication });
  const section = container.querySelector('.section');
  section.append(
    summaryCard(payload, state),
    layerGrid(state),
    actionCard(state, mcpConnection),
    setupCard(payload, state),
    technicalDetailsCard(payload, mcpConnection)
  );
  const controls = document.createElement('section');
  controls.className = 'connection-controls-section';
  container.appendChild(controls);
  await mountDesktopConnection(controls);
}

function summaryCard(payload, state) {
  const card = document.createElement('section');
  const summary = connectionSummary(state);
  card.className = `card connection-summary-card ${summary.tone}`;
  card.innerHTML = `
    <div class="card-head"><h3>ChatGPT connection</h3>${pillHtml(summary.label, summary.tone)}</div>
    <div class="card-body connection-stack">
      <div>
        <h3 class="connection-summary-title">${escapeHtml(summary.title)}</h3>
        <p class="connector-summary">${escapeHtml(summary.message)}</p>
      </div>
      <div class="connection-field">
        <span class="field-caption">ChatGPT MCP endpoint</span>
        <div class="connection-endpoint-row">
          <code class="connector-endpoint">${escapeHtml(payload.chatgptMcpUrl || 'Waiting for a permanent HTTPS endpoint')}</code>
          <button class="secondary" type="button" data-copy="mcp" ${payload.chatgptMcpUrl ? '' : 'disabled'}>Copy endpoint</button>
        </div>
      </div>
    </div>`;
  card.querySelector('[data-copy="mcp"]').onclick = () => copyValue(payload.chatgptMcpUrl, 'ChatGPT MCP endpoint copied.');
  return card;
}

function layerGrid(state) {
  const wrapper = document.createElement('section');
  wrapper.className = 'connection-layer-section';
  wrapper.innerHTML = '<div class="connection-layer-heading"><h3>Connection path</h3><p>These states are related, but they do not mean the same thing.</p></div>';
  const path = document.createElement('div');
  path.className = 'connection-path';
  for (const layer of connectionLayerViews(state)) path.appendChild(layerCard(layer));
  wrapper.appendChild(path);
  return wrapper;
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

function actionCard(state, mcpConnection = {}) {
  const card = document.createElement('section');
  card.className = 'connection-actions-bar';
  const summary = connectionSummary(state);
  card.innerHTML = `
    <div class="connection-actions-copy">
      <span class="field-caption">Connection actions</span>
      <strong>${escapeHtml(summary.label)}</strong>
    </div>
    <div class="connection-action-notices">
      ${recoveryNoticeHtml(state, mcpConnection)}
      ${state.error ? `<div class="connection-notice bad"><strong>${escapeHtml(state.error.code)}</strong><br>${escapeHtml(state.error.message)}</div>` : ''}
    </div>
    <div class="connection-actions">
      ${mcpRecoveryButtonHtml(state)}
      ${window.relaiDesktop ? '<button class="secondary" type="button" data-desktop-restart>Restart local service</button>' : ''}
      <button class="secondary" type="button" data-refresh-connection>Refresh status</button>
      <a class="buttonlike secondary" href="#settings/diagnostics">Open diagnostics</a>
    </div>`;
  card.querySelector('[data-mcp-retry]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    const result = await postJson('/api/mcp/recovery', { action: 'retry' }, { cache: 'no-store' });
    button.disabled = false;
    if (result.ok) toast(result.message || 'MCP transport reset. Waiting for a fresh client session.', { variant: 'success' });
    else toast(result.error || 'MCP recovery requires action in ChatGPT.', { variant: 'warn' });
    window.dispatchEvent(new CustomEvent('relai:dashboard-refresh'));
  });
  card.querySelector('[data-desktop-restart]')?.addEventListener('click', () => {
    window.relaiDesktop.restartService();
    toast('Local service restart requested.', { variant: 'info' });
  });
  card.querySelector('[data-refresh-connection]')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('relai:dashboard-refresh'));
    toast('Refreshing connection status…', { variant: 'info' });
  });
  return card;
}

function mcpRecoveryButtonHtml(state) {
  const status = state.mcpClient?.status || '';
  if (!['stale', 'capability_mismatch', 'reconnecting', 'degraded'].includes(status)) return '';
  return '<button type="button" data-mcp-retry>Reset MCP transport</button>';
}

function recoveryNoticeHtml(state, mcpConnection = {}) {
  const status = state.mcpClient?.status || '';
  if (!isMcpAuthenticationReady(state) && (state.chatgptReadiness?.status === 'authentication_required' || status === 'reauthentication_required')) {
    return `
      <div class="connection-notice warn connection-auth-recovery">
        <strong>Reconnect the existing app from ChatGPT Web.</strong>
        <ol>
          <li>Copy the current approval token below.</li>
          <li>Open <strong>Settings &gt; Apps &gt; Enabled Apps</strong> in ChatGPT Web and select <strong>Rel.AI MCP</strong>.</li>
          <li>Select <strong>Connect</strong> or <strong>Reconnect</strong> if shown. Otherwise, select Rel.AI MCP in a new chat and ask ChatGPT to use it.</li>
          <li>Paste the token on the Rel.AI authorization page, approve access, then retry your request.</li>
        </ol>
        <p>The endpoint is unchanged. Do not delete or recreate the ChatGPT app.</p>
      </div>`;
  }
  if (status === 'capability_mismatch' || status === 'reconnecting') {
    return '<div class="connection-notice warn"><strong>Tool synchronization is in progress.</strong><br>Rel.AI requested a fresh tool list. Use Reset MCP transport if the client remains stale.</div>';
  }
  if (status === 'degraded' || mcpConnection.manualRecoveryRequired) {
    return '<div class="connection-notice bad"><strong>ChatGPT action is required.</strong><br>Open ChatGPT Settings &gt; Apps, refresh the Rel.AI actions, approve changed actions if prompted, then reconnect the existing app.</div>';
  }
  if (state.chatgptReadiness?.status === 'bearer_authorized' && state.chatgptReadiness?.oauthApprovalRequired === true) {
    return '<div class="connection-notice warn"><strong>Bearer access is working.</strong><br>OAuth connections still require approval with the current approval token.</div>';
  }
  if (status === 'no_requests' || status === 'ready') {
    return '<div class="connection-notice">Authentication is valid and the endpoint is ready. No authorized MCP request has been received since startup.</div>';
  }
  if (status === 'idle') {
    return '<div class="connection-notice">Authentication is valid and the endpoint is idle. The last successful request is outside the recent-activity window.</div>';
  }
  return '';
}

function setupCard(payload, state) {
  const ready = isMcpAuthenticationReady(state);
  const extraSteps = Array.isArray(payload.nextSteps) ? payload.nextSteps : [];
  const steps = `
    <div class="setup-steps">
      <div class="step"><span class="step-num">1</span><div>Open <strong>Settings &gt; Apps &gt; Create</strong> in ChatGPT. Enable Developer Mode if custom app creation is hidden.</div></div>
      <div class="step"><span class="step-num">2</span><div>Name the app <strong>Rel.AI MCP</strong>, paste the endpoint above, choose <strong>OAuth</strong>, then approve with the Rel.AI approval token.</div></div>
      <div class="step"><span class="step-num">3</span><div>Select the app in chat and begin by asking it to inspect a workspace before making changes.</div></div>
      ${notesHtml(extraSteps)}
    </div>`;
  if (ready) {
    const details = document.createElement('details');
    details.className = 'card connector-details connection-setup-details';
    details.innerHTML = `
      <summary class="connector-details-summary">
        <span><strong>ChatGPT setup guide</strong><small>The app is ready; reopen these steps only when reconnecting or configuring another app.</small></span>
        <span aria-hidden="true">›</span>
      </summary>
      <div class="card-body">${steps}</div>`;
    return details;
  }
  const card = document.createElement('section');
  card.className = 'card connection-setup-card';
  card.innerHTML = `
    <div class="card-head"><h3>Connect ChatGPT</h3><span class="section-action">three steps</span></div>
    <div class="card-body">${steps}</div>`;
  return card;
}

function technicalDetailsCard(payload, mcpConnection = {}) {
  const details = document.createElement('details');
  details.className = 'card connector-details';
  const dashboardNoToken = dashboardUrl(payload);
  details.innerHTML = `
    <summary class="connector-details-summary">
      <span><strong>Local and diagnostic URLs</strong><small>Health checks and local dashboard access</small></span>
      <span aria-hidden="true">›</span>
    </summary>
    <div class="card-body connection-stack">
      <div class="connection-facts">
        <div class="connection-fact"><span class="connection-fact-label">Authentication</span><span>${escapeHtml(payload.chatgptAuthMode || 'OAuth')}</span></div>
        <div class="connection-fact"><span class="connection-fact-label">MCP activity</span><span>${escapeHtml(mcpConnection.activityStatus || mcpConnection.status || 'unknown')}</span></div>
        <div class="connection-fact"><span class="connection-fact-label">Active requests</span><span>${escapeHtml(String(mcpConnection.activeRequestCount || 0))}</span></div>
        <div class="connection-fact"><span class="connection-fact-label">Visible tools</span><span>${escapeHtml(String(mcpConnection.externallyVisibleToolCount || 0))}</span></div>
        <div class="connection-fact"><span class="connection-fact-label">Tool manifest</span><code>${escapeHtml(mcpConnection.toolManifestVersion || '—')}</code></div>
        <div class="connection-fact"><span class="connection-fact-label">Health URL</span><code>${escapeHtml(payload.chatgptHealthUrl || 'Waiting for a permanent HTTPS endpoint')}</code></div>
        <div class="connection-fact"><span class="connection-fact-label">Dashboard URL</span><code>${escapeHtml(dashboardNoToken || '—')}</code></div>
      </div>
      <div class="connection-actions">
        <button class="secondary" type="button" data-copy="dashboard" ${dashboardNoToken ? '' : 'disabled'}>Copy dashboard URL</button>
      </div>
      <div class="connection-notice">Approval tokens are managed by the installed app through the secure controls below and are never included in these URLs.</div>
    </div>`;
  details.querySelector('[data-copy="dashboard"]').onclick = () => copyValue(dashboardNoToken, 'Dashboard URL copied.');
  return details;
}

function dashboardUrl(payload) {
  return stripToken(payload.dashboardUrl || (payload.localBaseUrl ? payload.localBaseUrl + '/dashboard' : ''));
}

function notesHtml(extraSteps) {
  if (!extraSteps.length) return '';
  const items = extraSteps.map(step => `<li>${escapeHtml(step)}</li>`).join('');
  return `
    <details class="connection-notice connector-notes-details">
      <summary>Environment notes</summary>
      <ul class="connection-notes">${items}</ul>
    </details>`;
}

async function copyValue(value, message) {
  if (!value) {
    toast('Nothing to copy yet.', { variant: 'warn' });
    return;
  }
  try {
    await copyText(value);
    toast(message, { variant: 'success' });
  } catch (error) {
    debugError(error);
    toast('Clipboard access failed.', { variant: 'error' });
  }
}

function stripTokenFallback(url) {
  const raw = String(url || '');
  const questionIndex = raw.indexOf('?');
  if (questionIndex < 0) return raw;
  const base = raw.slice(0, questionIndex);
  const query = raw.slice(questionIndex + 1).split('&').filter(part => !part.toLowerCase().startsWith('token='));
  return query.length ? `${base}?${query.join('&')}` : base;
}

function stripToken(url) {
  try {
    const parsed = new URL(url, location.origin);
    parsed.searchParams.delete('token');
    parsed.searchParams.delete('bootstrap');
    return parsed.href;
  } catch (error) {
    debugError(error);
    return stripTokenFallback(url);
  }
}

function debugError(error) {
  if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
}
