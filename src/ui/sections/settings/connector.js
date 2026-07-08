import { fetchJson } from '../../api.js';
import { toast } from '../../components/toast.js';

export function mountConnector(container) {
  container.innerHTML = '<div style="padding:8px 0;color:var(--text-muted);font-size:13px;">Loading…</div>';
  _load(container);
}

async function _load(container) {
  const payload = await fetchJson('/api/connection');
  container.innerHTML = '<div class="section"><div class="section-head"><div><h2>ChatGPT Connector</h2><p>Copy one URL, create the ChatGPT app, approve with OAuth, then select the app in chat.</p></div></div></div>';
  if (!payload) {
    container.innerHTML += '<div class="empty">Failed to load connector details.</div>';
    return;
  }

  const section = container.querySelector('.section');
  section.appendChild(summaryCard(payload));
  section.appendChild(stepsCard(payload));
}

function connectionStatus(payload) {
  return payload.permanentUrlConfigured
    ? { text: 'HTTPS URL configured', tone: 'ok', style: 'border-color:rgba(71,221,138,.22);background:rgba(71,221,138,.07);', message: 'Use this /mcp endpoint when creating or updating the ChatGPT app. Keep the URL stable; only update ChatGPT if this URL changes.' }
    : { text: 'HTTPS URL required', tone: 'warn', style: 'border-color:rgba(255,194,75,.22);background:rgba(255,194,75,.07);', message: 'ChatGPT rejects localhost MCP endpoints for OAuth. Start a public HTTPS tunnel or configure a stable public URL, then copy the generated /mcp URL.' };
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
    <div class="card-head">
      <h3>Connection details</h3>
      <span class="status-pill ${status.tone}">${status.text}</span>
    </div>
    <div class="card-body" style="display:grid;gap:14px;">
      <div class="empty" style="text-align:left;padding:12px;line-height:1.55;${status.style}">${status.message}</div>
      <div style="display:grid;gap:8px;">
        <div style="font-size:12px;color:var(--text-muted);">CHATGPT MCP ENDPOINT</div>
        <code class="copy-box" style="min-height:auto;max-height:none;">${escapeHtml(payload.chatgptMcpUrl || 'Waiting for HTTPS tunnel')}</code>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" data-copy="mcp" ${payload.chatgptMcpUrl ? '' : 'disabled'}>Copy ChatGPT MCP URL</button>
          <button class="secondary" type="button" data-copy="dashboard">Copy dashboard URL (no token)</button>
          <button class="secondary" type="button" data-copy="dashboardToken">Copy with token</button>
        </div>
      </div>
      <div style="display:grid;gap:8px;font-size:13px;">
        <div style="display:flex;gap:10px;flex-wrap:wrap;"><span style="color:var(--text-muted);min-width:140px;">ChatGPT auth</span><span>${escapeHtml(payload.chatgptAuthMode || 'OAuth')}</span></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;"><span style="color:var(--text-muted);min-width:140px;">Health URL</span><code style="font-size:12px;word-break:break-all;">${escapeHtml(payload.chatgptHealthUrl || 'Waiting for HTTPS tunnel')}</code></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;"><span style="color:var(--text-muted);min-width:140px;">Dashboard URL</span><code style="font-size:12px;word-break:break-all;">${escapeHtml(dashboardNoToken || '—')}</code></div>
      </div>
    </div>
  `;

  card.querySelector('[data-copy="mcp"]').onclick = () => copyValue(payload.chatgptMcpUrl, 'ChatGPT MCP URL copied.');
  card.querySelector('[data-copy="dashboard"]').onclick = () => copyValue(dashboardNoToken, 'Dashboard URL copied (no token — sign in with your dashboard token).');
  card.querySelector('[data-copy="dashboardToken"]').onclick = () => copyValue(payload.dashboardUrl, 'Dashboard URL with token copied — treat it like a password.');
  return card;
}

function notesHtml(extraSteps) {
  if (!extraSteps.length) return '';
  const items = extraSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join('');
  return `<div class="empty" style="text-align:left;padding:12px;line-height:1.5;"><strong style="color:var(--text);">Connection notes</strong><ul style="margin:8px 0 0 18px;padding:0;display:grid;gap:6px;">${items}</ul></div>`;
}

function stepsCard(payload) {
  const card = document.createElement('div');
  card.className = 'card';
  const extraSteps = Array.isArray(payload.nextSteps) ? payload.nextSteps : [];
  const notes = notesHtml(extraSteps);
  card.innerHTML = `
    <div class="card-head"><h3>Use in ChatGPT</h3><span class="section-action">finish setup, then test</span></div>
    <div class="card-body setup-steps">
      <div class="step"><span class="step-num">1</span><div>If app creation is not visible, enable <strong>Developer Mode</strong> for custom MCP apps or ask your workspace admin.</div></div>
      <div class="step"><span class="step-num">2</span><div>In ChatGPT, go to <strong>Settings &gt; Apps &gt; Create</strong>. Admins can also use <strong>Workspace Settings &gt; Apps &gt; Create</strong>.</div></div>
      <div class="step"><span class="step-num">3</span><div>Name it <strong>Rel.AI MCP</strong>, paste the endpoint above, choose <strong>OAuth</strong>, and create the app.</div></div>
      <div class="step"><span class="step-num">4</span><div>When ChatGPT opens the sign-in page, enter your Rel.AI <strong>dashboard token</strong> to approve.</div></div>
      <div class="step"><span class="step-num">5</span><div>Open a chat, select the <strong>Rel.AI MCP</strong> app, then start with: <code>Call relai_git_status and relai_repo_snapshot for workspace "your-workspace". Do not modify files yet.</code></div></div>
      ${notes}
    </div>
  `;
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
    if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
    toast('Clipboard access failed.', { variant: 'error' });
  }
}

function stripTokenFallback(url) {
  const raw = String(url || '');
  const questionIndex = raw.indexOf('?');
  if (questionIndex < 0) return raw;
  const base = raw.slice(0, questionIndex);
  const query = raw.slice(questionIndex + 1).split('&').filter((part) => !part.toLowerCase().startsWith('token='));
  return query.length ? `${base}?${query.join('&')}` : base;
}

function stripToken(url) {
  try {
    // Keep the full absolute URL — this lands in the clipboard, where a relative
    // path like "/dashboard" would be useless outside this page.
    const u = new URL(url, location.origin);
    u.searchParams.delete('token');
    return u.href;
  } catch (error) {
    if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
    return stripTokenFallback(url);
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
