import { fetchJson } from '../../api.js';
import { toast } from '../../components/toast.js';
import { copyText } from '../../clipboard.js';

export function mountConnector(container) {
  container.innerHTML = '<div class="connection-loading">Loading connector details…</div>';
  loadConnector(container).catch(error => {
    container.innerHTML = `<div class="empty">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  });
}

async function loadConnector(container) {
  const payload = await fetchJson('/api/connection');
  container.innerHTML = `
    <div class="section">
      <div class="section-head">
        <div>
          <h2>Connector</h2>
          <p>Manage the single MCP endpoint ChatGPT uses to reach this machine.</p>
        </div>
      </div>
    </div>`;
  if (!payload || payload.ok === false) {
    container.querySelector('.section').insertAdjacentHTML('beforeend', '<div class="empty">Failed to load connector details.</div>');
    return;
  }

  const section = container.querySelector('.section');
  section.appendChild(summaryCard(payload));

  if (window.relaiDesktop) {
    const runtimeHost = document.createElement('div');
    runtimeHost.className = 'connector-runtime-host';
    section.appendChild(runtimeHost);
    loadDesktopRuntime(runtimeHost);
  }

  section.append(setupCard(payload), technicalDetailsCard(payload));
}

function connectionStatus(payload) {
  return payload.permanentUrlConfigured
    ? { text: 'Ready', tone: 'ok', message: 'This is the endpoint to use when creating or updating the ChatGPT app.' }
    : { text: 'Setup required', tone: 'warn', message: 'A stable public HTTPS endpoint is required before ChatGPT can connect.' };
}

function dashboardUrl(payload) {
  return stripToken(payload.dashboardUrl || (payload.localBaseUrl ? payload.localBaseUrl + '/dashboard' : ''));
}

function summaryCard(payload) {
  const card = document.createElement('section');
  card.className = 'card connector-primary-card';
  const status = connectionStatus(payload);
  card.innerHTML = `
    <div class="card-head"><h3>ChatGPT MCP endpoint</h3><span class="status-pill ${status.tone}">${status.text}</span></div>
    <div class="card-body connection-stack">
      <p class="connector-summary">${escapeHtml(status.message)}</p>
      <code class="copy-box connector-endpoint">${escapeHtml(payload.chatgptMcpUrl || 'Waiting for HTTPS tunnel')}</code>
      <div class="connection-actions">
        <button type="button" data-copy="mcp" ${payload.chatgptMcpUrl ? '' : 'disabled'}>Copy endpoint</button>
      </div>
    </div>`;
  card.querySelector('[data-copy="mcp"]').onclick = () => copyValue(payload.chatgptMcpUrl, 'ChatGPT MCP endpoint copied.');
  return card;
}

async function loadDesktopRuntime(host) {
  try {
    const status = await window.relaiDesktop.getStatus();
    host.replaceChildren(desktopRuntimeCard(status));
  } catch (error) {
    host.innerHTML = `<div class="connection-notice bad">Desktop service status is unavailable: ${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  }
}

function desktopRuntimeCard(status = {}) {
  const card = document.createElement('section');
  const tunnel = status.tunnelStatus || 'stopped';
  let tone = 'warn';
  let tunnelLabel = 'Stopped';
  if (tunnel === 'running') {
    tone = 'ok';
    tunnelLabel = 'Connected';
  } else if (tunnel === 'connecting') {
    tunnelLabel = 'Connecting';
  } else if (tunnel === 'failed') {
    tone = 'bad';
    tunnelLabel = 'Failed';
  }
  card.className = 'card desktop-runtime-card';
  card.innerHTML = `
    <div class="card-head"><h3>Desktop connection</h3><span class="status-pill ${tone}">${escapeHtml(tunnelLabel)}</span></div>
    <div class="card-body connection-stack">
      <div class="connection-facts">
        <div class="connection-fact"><span class="connection-fact-label">Local service</span><span>${status.serverRunning ? 'Running' : 'Stopped'}</span></div>
        <div class="connection-fact"><span class="connection-fact-label">Public tunnel</span><span>${escapeHtml(tunnelLabel)}</span></div>
      </div>
      ${status.error ? `<div class="connection-notice bad">${escapeHtml(status.error)}</div>` : ''}
      <div class="connection-actions">
        <button type="button" data-desktop-settings>Desktop settings</button>
        <button class="secondary" type="button" data-desktop-restart>Restart connection</button>
        <button class="secondary" type="button" data-desktop-recovery>Recovery details</button>
      </div>
    </div>`;
  card.querySelector('[data-desktop-settings]').onclick = () => window.relaiDesktop.openSettings();
  card.querySelector('[data-desktop-restart]').onclick = () => window.relaiDesktop.restartService();
  card.querySelector('[data-desktop-recovery]').onclick = () => window.relaiDesktop.openRecovery();
  return card;
}

function setupCard(payload) {
  const card = document.createElement('section');
  card.className = 'card';
  const extraSteps = Array.isArray(payload.nextSteps) ? payload.nextSteps : [];
  card.innerHTML = `
    <div class="card-head"><h3>Connect ChatGPT</h3><span class="section-action">three steps</span></div>
    <div class="card-body setup-steps">
      <div class="step"><span class="step-num">1</span><div>Open <strong>Settings &gt; Apps &gt; Create</strong> in ChatGPT. Enable Developer Mode if custom app creation is hidden.</div></div>
      <div class="step"><span class="step-num">2</span><div>Name the app <strong>Rel.AI MCP</strong>, paste the endpoint above, choose <strong>OAuth</strong>, then approve with the dashboard token.</div></div>
      <div class="step"><span class="step-num">3</span><div>Select the app in chat and begin by asking it to inspect a workspace before making changes.</div></div>
      ${notesHtml(extraSteps)}
    </div>`;
  return card;
}

function technicalDetailsCard(payload) {
  const details = document.createElement('details');
  details.className = 'card connector-details';
  const dashboardNoToken = dashboardUrl(payload);
  details.innerHTML = `
    <summary class="connector-details-summary">
      <span><strong>Local and diagnostic URLs</strong><small>Health checks, dashboard access, and token URL</small></span>
      <span aria-hidden="true">›</span>
    </summary>
    <div class="card-body connection-stack">
      <div class="connection-facts">
        <div class="connection-fact"><span class="connection-fact-label">Authentication</span><span>${escapeHtml(payload.chatgptAuthMode || 'OAuth')}</span></div>
        <div class="connection-fact"><span class="connection-fact-label">Health URL</span><code>${escapeHtml(payload.chatgptHealthUrl || 'Waiting for HTTPS tunnel')}</code></div>
        <div class="connection-fact"><span class="connection-fact-label">Dashboard URL</span><code>${escapeHtml(dashboardNoToken || '—')}</code></div>
      </div>
      <div class="connection-actions">
        <button class="secondary" type="button" data-copy="dashboard">Copy dashboard URL</button>
        <button class="secondary" type="button" data-copy="dashboardToken">Copy URL with token</button>
      </div>
      <div class="connection-notice warn">A dashboard URL containing the token grants access. Treat it like a password.</div>
    </div>`;
  details.querySelector('[data-copy="dashboard"]').onclick = () => copyValue(dashboardNoToken, 'Dashboard URL copied.');
  details.querySelector('[data-copy="dashboardToken"]').onclick = () => copyValue(payload.dashboardUrl, 'Dashboard URL with token copied. Treat it like a password.');
  return details;
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
