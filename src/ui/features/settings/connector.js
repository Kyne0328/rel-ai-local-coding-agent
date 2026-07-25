import { fetchJson } from '../../api.js';
import { toast } from '../../components/toast.js';
import { copyText } from '../../clipboard.js';
import { get as getStore } from '../../store.js';
import { connectionLayerViews, connectionStateFor, connectionSummary } from '../../connection-state.js';
import { mountDesktopConnection } from './desktop-connection.js';

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

  const state = connectionStateFor(getStore());
  const section = container.querySelector('.section');
  section.append(
    summaryCard(payload, state),
    layerGrid(state),
    actionCard(state),
    setupCard(payload, state),
    technicalDetailsCard(payload)
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
    <div class="card-head"><h3>ChatGPT connection</h3><span class="status-pill ${summary.tone}">${escapeHtml(summary.label)}</span></div>
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

function actionCard(state) {
  const card = document.createElement('section');
  card.className = 'connection-actions-bar';
  const summary = connectionSummary(state);
  card.innerHTML = `
    <div class="connection-actions-copy">
      <span class="field-caption">Connection actions</span>
      <strong>${escapeHtml(summary.label)}</strong>
    </div>
    <div class="connection-action-notices">
      ${authenticationRecoveryHtml(state)}
      ${state.error ? `<div class="connection-notice bad"><strong>${escapeHtml(state.error.code)}</strong><br>${escapeHtml(state.error.message)}</div>` : ''}
    </div>
    <div class="connection-actions">
      ${window.relaiDesktop ? '<button type="button" data-desktop-restart>Restart connection</button>' : ''}
      <button class="secondary" type="button" data-refresh-connection>Refresh status</button>
      <a class="buttonlike secondary" href="#settings/diagnostics">Open diagnostics</a>
    </div>`;
  card.querySelector('[data-desktop-restart]')?.addEventListener('click', () => {
    window.relaiDesktop.restartService();
    toast('Connection restart requested.', { variant: 'info' });
  });
  card.querySelector('[data-refresh-connection]')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('relai:dashboard-refresh'));
    toast('Refreshing connection status…', { variant: 'info' });
  });
  return card;
}

function authenticationRecoveryHtml(state) {
  if (state.chatgptReadiness?.status !== 'authentication_required') return '';
  return `
    <div class="connection-notice warn connection-auth-recovery">
      <strong>Approve the existing ChatGPT app again.</strong>
      <ol>
        <li>Use the Approval token controls below and copy the current token.</li>
        <li>Retry the existing Rel.AI app in ChatGPT.</li>
        <li>Enter the token when the Rel.AI authorization page opens.</li>
      </ol>
      <p>The MCP endpoint is unchanged. Do not delete or recreate the ChatGPT app.</p>
    </div>`;
}

function setupCard(payload, state) {
  const ready = state.chatgptReadiness?.status === 'ready';
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

function technicalDetailsCard(payload) {
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

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
