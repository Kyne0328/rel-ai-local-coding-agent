import { fetchJson } from '/ui/api.js';
export function mountConnector(container) {
  container.innerHTML = '<div style="padding:8px 0;color:var(--text-muted);font-size:13px;">Loading…</div>';
  _load(container);
}
async function _load(container) {
  const payload = await fetchJson('/api/connection');
  container.innerHTML = '<h3 style="margin:0 0 16px;font-size:15px;">ChatGPT Connector</h3>';
  if (!payload) { container.innerHTML += '<div class="empty">Failed to load connector.</div>'; return; }
  const status = payload.permanentUrlConfigured ? 'permanent URL configured' : 'local only — no stable public URL';
  const e = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  container.innerHTML += `<div style="display:grid;gap:8px;font-size:13px;">
    <div style="display:flex;gap:10px;"><span style="color:var(--text-muted);min-width:140px;">Status</span><span>${e(status)}</span></div>
    <div style="display:flex;gap:10px;"><span style="color:var(--text-muted);min-width:140px;">ChatGPT MCP URL</span><code style="font-size:12px;word-break:break-all;">${e(payload.chatgptMcpUrl || '—')}</code></div>
  </div>
  <div style="margin-top:16px;display:grid;gap:8px;">
    <div class="step"><span class="step-num">1</span><div>Go to <strong>ChatGPT → Settings → Connectors → Add MCP server</strong></div></div>
    <div class="step"><span class="step-num">2</span><div>Paste the ChatGPT MCP URL above. Set authentication to <strong>No Authentication</strong>.</div></div>
  </div>`;
}
