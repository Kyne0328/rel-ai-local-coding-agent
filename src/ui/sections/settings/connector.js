import { fetchJson } from '../../api.js';
import { toast } from '../../components/toast.js';

export function mountConnector(container) {
  container.innerHTML = '<div class="connection-loading">Loading connector details…</div>';
  loadConnector(container);
}

async function loadConnector(container) {
  const payload = await fetchJson('/api/connection');
  container.innerHTML = '<div class="section"><div class="section-head"><div><h2>ChatGPT Connector</h2><p>Copy one endpoint, create the ChatGPT app, approve with OAuth, then select the app in chat.</p></div></div></div>';
  if (!payload || payload.ok === false) {
    container.innerHTML += '<div class="empty">Failed to load connector details.</div>';
    return;
  }
  const section = container.querySelector('.section');
  section.append(summaryCard(payload), stepsCard(payload));
}

function connectionStatus(payload) {
  return payload.permanentUrlConfigured
    ? { text: 'HTTPS endpoint configured', tone: 'ok', message: 'Use this /mcp endpoint when creating or updating the ChatGPT app. Keep it stable so the app does not need to be recreated.' }
    : { text: 'HTTPS endpoint required', tone: 'warn', message: 'ChatGPT rejects localhost MCP endpoints for OAuth. Start a public HTTPS tunnel or configure a stable public URL.' };
}

function dashboardUrl(payload) {
  return stripToken(payload.dashboardUrl || (payload.localBaseUrl ? payload.localBaseUrl + '/dashboard' : ''));
}

function summaryCard(payload) {
  const card = document.createElement('div');
  card.className = 'card';
  const status = connectionStatus(payload);
  const dashboardNoToken = dashboardUrl(payload);
  card.innerHTML = `
    <div class="card-head"><h3>Connection details</h3><span class="status-pill ${status.tone}">${status.text}</span></div>
    <div class="card-body connection-stack">
      <div class="connection-notice ${status.tone}">${status.message}</div>
      <div class="connection-field">
        <div class="field-caption">ChatGPT MCP endpoint</div>
        <code class="copy-box">${escapeHtml(payload.chatgptMcpUrl || 'Waiting for HTTPS tunnel')}</code>
        <div class="connection-actions">
          <button type="button" data-copy="mcp" ${payload.chatgptMcpUrl ? '' : 'disabled'}>Copy MCP endpoint</button>
          <button class="secondary" type="button" data-copy="dashboard">Copy dashboard URL</button>
          <button class="secondary" type="button" data-copy="dashboardToken">Copy URL with token</button>
        </div>
      </div>
      <div class="connection-facts">
        <div class="connection-fact"><span class="connection-fact-label">ChatGPT authentication</span><span>${escapeHtml(payload.chatgptAuthMode || 'OAuth')}</span></div>
        <div class="connection-fact"><span class="connection-fact-label">Health URL</span><code>${escapeHtml(payload.chatgptHealthUrl || 'Waiting for HTTPS tunnel')}</code></div>
        <div class="connection-fact"><span class="connection-fact-label">Dashboard URL</span><code>${escapeHtml(dashboardNoToken || '—')}</code></div>
      </div>
    </div>`;

  card.querySelector('[data-copy="mcp"]').onclick = () => copyValue(payload.chatgptMcpUrl, 'ChatGPT MCP endpoint copied.');
  card.querySelector('[data-copy="dashboard"]').onclick = () => copyValue(dashboardNoToken, 'Dashboard URL copied.');
  card.querySelector('[data-copy="dashboardToken"]').onclick = () => copyValue(payload.dashboardUrl, 'Dashboard URL with token copied. Treat it like a password.');
  return card;
}

function notesHtml(extraSteps) {
  if (!extraSteps.length) return '';
  const items = extraSteps.map(step => `<li>${escapeHtml(step)}</li>`).join('');
  return `<div class="connection-notice"><strong>Connection notes</strong><ul class="connection-notes">${items}</ul></div>`;
}

function stepsCard(payload) {
  const card = document.createElement('div');
  card.className = 'card';
  const extraSteps = Array.isArray(payload.nextSteps) ? payload.nextSteps : [];
  card.innerHTML = `
    <div class="card-head"><h3>Use in ChatGPT</h3><span class="section-action">finish setup, then test</span></div>
    <div class="card-body setup-steps">
      <div class="step"><span class="step-num">1</span><div>Enable <strong>Developer Mode</strong> for custom MCP apps if app creation is not visible.</div></div>
      <div class="step"><span class="step-num">2</span><div>Open <strong>Settings &gt; Apps &gt; Create</strong> in ChatGPT.</div></div>
      <div class="step"><span class="step-num">3</span><div>Name it <strong>Rel.AI MCP</strong>, paste the endpoint, choose <strong>OAuth</strong>, and create the app.</div></div>
      <div class="step"><span class="step-num">4</span><div>Approve with your Rel.AI <strong>dashboard token</strong>.</div></div>
      <div class="step"><span class="step-num">5</span><div>Select the app in chat, then start with: <code>Call relai_git_status and relai_repo_snapshot for workspace "your-workspace". Do not modify files yet.</code></div></div>
      ${notesHtml(extraSteps)}
    </div>`;
  return card;
}

async function copyValue(value, message) {
  if (!value) {
    toast('Nothing to copy yet.', { variant: 'warn' });
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
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
