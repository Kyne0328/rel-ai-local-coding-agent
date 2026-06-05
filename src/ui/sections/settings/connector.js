import { fetchJson } from '/ui/api.js';
import { toast } from '/ui/components/toast.js';

export function mountConnector(container) {
  container.innerHTML = '<div style="padding:8px 0;color:var(--text-muted);font-size:13px;">Loading…</div>';
  _load(container);
}

async function _load(container) {
  const payload = await fetchJson('/api/connection');
  container.innerHTML = '<div class="section"><div class="section-head"><div><h2>ChatGPT Connector</h2><p>Copy the right MCP URL, confirm the auth mode, and finish the connection without guesswork.</p></div></div></div>';
  if (!payload) {
    container.innerHTML += '<div class="empty">Failed to load connector details.</div>';
    return;
  }

  const section = container.querySelector('.section');
  section.appendChild(summaryCard(payload));
  section.appendChild(stepsCard(payload));
}

function summaryCard(payload) {
  const card = document.createElement('div');
  card.className = 'card';
  const statusText = payload.permanentUrlConfigured ? 'Permanent URL configured' : 'Local-only URL';
  const statusTone = payload.permanentUrlConfigured ? 'ok' : 'warn';
  card.innerHTML = `
    <div class="card-head">
      <h3>Connection details</h3>
      <span class="status-pill ${statusTone}">${statusText}</span>
    </div>
    <div class="card-body" style="display:grid;gap:14px;">
      <div class="empty" style="text-align:left;padding:12px;line-height:1.55;${payload.permanentUrlConfigured ? 'border-color:rgba(71,221,138,.22);background:rgba(71,221,138,.07);' : 'border-color:rgba(255,194,75,.22);background:rgba(255,194,75,.07);'}">
        ${payload.permanentUrlConfigured
          ? 'This is the stable URL to paste into ChatGPT. You should only need to update the ChatGPT connector if this URL or its secret path changes.'
          : 'This URL works for local diagnostics, but it is not a durable ChatGPT setup. For a stable connector, configure a permanent HTTPS public URL and relaunch Rel.AI MCP with that URL.'}
      </div>
      <div style="display:grid;gap:8px;">
        <div style="font-size:12px;color:var(--text-muted);">COPY THIS FOR CHATGPT</div>
        <code class="copy-box" style="min-height:auto;max-height:none;">${escapeHtml(payload.chatgptMcpUrl || '—')}</code>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" data-copy="mcp">Copy ChatGPT MCP URL</button>
          <button class="secondary" type="button" data-copy="dashboard">Copy dashboard URL</button>
        </div>
      </div>
      <div style="display:grid;gap:8px;font-size:13px;">
        <div style="display:flex;gap:10px;flex-wrap:wrap;"><span style="color:var(--text-muted);min-width:140px;">Auth mode</span><span>${escapeHtml(payload.chatgptAuthMode || 'No Authentication')}</span></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;"><span style="color:var(--text-muted);min-width:140px;">Health URL</span><code style="font-size:12px;word-break:break-all;">${escapeHtml(payload.chatgptHealthUrl || '—')}</code></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;"><span style="color:var(--text-muted);min-width:140px;">Dashboard URL</span><code style="font-size:12px;word-break:break-all;">${escapeHtml(payload.dashboardUrl || '—')}</code></div>
      </div>
    </div>
  `;

  card.querySelector('[data-copy="mcp"]').onclick = () => copyValue(payload.chatgptMcpUrl, 'ChatGPT MCP URL copied.');
  card.querySelector('[data-copy="dashboard"]').onclick = () => copyValue(payload.dashboardUrl, 'Dashboard URL copied.');
  return card;
}

function stepsCard(payload) {
  const card = document.createElement('div');
  card.className = 'card';
  // Steps 1-3 are the fixed core connect flow. payload.nextSteps carries deployment
  // guidance (local vs. tunnel) and continues the numbering. The old fallback array
  // duplicated steps 1-3 verbatim as 4-6 when nextSteps was empty; drop it.
  const extraSteps = Array.isArray(payload.nextSteps) ? payload.nextSteps : [];
  card.innerHTML = `
    <div class="card-head"><h3>Next steps</h3><span class="section-action">finish the connection</span></div>
    <div class="card-body setup-steps">
      <div class="step"><span class="step-num">1</span><div>Go to <strong>ChatGPT → Settings → Connectors → Add MCP server</strong>.</div></div>
      <div class="step"><span class="step-num">2</span><div>Paste the <strong>ChatGPT MCP URL</strong> exactly as shown above.</div></div>
      <div class="step"><span class="step-num">3</span><div>Set authentication to <strong>OAuth</strong>. ChatGPT opens a sign-in page — enter your Rel.AI <strong>dashboard token</strong> to approve the connection.</div></div>
      ${extraSteps.map((step, index) => `<div class="step"><span class="step-num">${index + 4}</span><div>${escapeHtml(step)}</div></div>`).join('')}
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
  } catch (_error) {
    toast('Clipboard access failed.', { variant: 'error' });
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
