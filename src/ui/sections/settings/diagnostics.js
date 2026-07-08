import { fetchJson } from '../../api.js';
import { esc } from '../../utils.js';

export function mountDiagnostics(container) {
  container.innerHTML = '';
  const head = document.createElement('div');
  head.style.cssText = 'display:grid;gap:4px;margin-bottom:14px;';
  head.innerHTML = '<h3 style="margin:0;font-size:15px;">System status</h3><p style="margin:0;color:var(--text-muted);font-size:13px;">Runtime checks for the local bridge. Developer details are available only when needed.</p>';
  container.appendChild(head);

  const cards = document.createElement('div');
  cards.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;max-width:980px;';
  container.appendChild(cards);

  const raw = document.createElement('pre');
  raw.style.cssText = 'background:var(--bg);border:1px solid var(--line-soft);border-radius:8px;padding:12px;font-size:12px;overflow:auto;max-height:340px;margin-top:14px;display:none;';
  container.appendChild(raw);

  loadAll(cards, raw);
}

async function loadAll(cards, raw) {
  cards.innerHTML = '<div class="empty">Loading system status...</div>';
  const [health, aliasCheck, cautionData, connection] = await Promise.all([
    fetchJson('/api/health-monitor'),
    fetchJson('/api/alias-diagnostics'),
    fetchJson('/api/caution-summary'),
    fetchJson('/api/connection')
  ]);
  cards.innerHTML = '';
  cards.appendChild(healthCard(health, raw));
  cards.appendChild(connectorCard(connection, raw));
  cards.appendChild(aliasConsistencyCard(aliasCheck, raw));
  const cautionCard = cautionEscalationsCard(cautionData, raw);
  if (cautionCard) cards.appendChild(cautionCard);
}

function healthCard(data, raw) {
  const findings = Array.isArray(data?.findings) ? data.findings.filter(f => f.severity !== 'info') : [];
  const value = healthValue(data, findings);
  return summaryCard('Health', value, findings, raw, data, {
    empty: 'No runtime issues found.',
    goodWhenEmpty: true
  });
}

function healthValue(data, findings) {
  if (data == null) return 'Unknown';
  return data.ok !== false && findings.length === 0 ? 'All clear' : 'Needs attention';
}

function connectorCard(data, raw) {
  const hasPublicUrl = Boolean(data?.chatgptMcpUrl);
  const hasToken = Boolean(data?.token === 'set');
  const value = hasPublicUrl ? 'ChatGPT ready' : 'Local only';
  const details = [];
  if (hasPublicUrl) details.push('OAuth endpoint is configured for ChatGPT.');
  else details.push('No public ChatGPT URL is configured. Local dashboard use is still available.');
  details.push(hasToken ? 'Dashboard token is configured.' : 'Dashboard token is missing.');
  return textCard('Connector', value, details, raw, data, hasPublicUrl && hasToken ? 'var(--green)' : 'var(--yellow)');
}

function summaryCard(title, value, findings, raw, payload, options = {}) {
  const card = document.createElement('div');
  card.className = 'card';
  const list = Array.isArray(findings) ? findings : [];
  const hasError = list.some(f => f.severity === 'error');
  const color = summaryColor(hasError, options);
  card.innerHTML = `<div class="card-head"><h3>${esc(title)}</h3><button class="secondary" style="min-height:24px;padding:0 8px;font-size:11px;">Details</button></div>`;
  const body = document.createElement('div');
  body.className = 'card-body';
  body.style.display = 'grid';
  body.style.gap = '8px';
  body.innerHTML = `<div style="font-size:22px;font-weight:800;color:${color};">${esc(value)}</div>` +
    (list.length ? list.slice(0, 5).map(f => findingHtml(f)).join('') : `<div style="font-size:12px;color:var(--text-muted);">${esc(options.empty || 'No findings.')}</div>`);
  card.appendChild(body);
  card.querySelector('button').onclick = () => showRaw(raw, payload);
  return card;
}

function summaryColor(hasError, options) {
  if (hasError) return 'var(--red)';
  return options.goodWhenEmpty ? 'var(--green)' : 'var(--blue)';
}

function textCard(title, value, lines, raw, payload, color = 'var(--blue)') {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h3>${esc(title)}</h3><button class="secondary" style="min-height:24px;padding:0 8px;font-size:11px;">Details</button></div>`;
  const body = document.createElement('div');
  body.className = 'card-body';
  body.style.display = 'grid';
  body.style.gap = '8px';
  body.innerHTML = `<div style="font-size:22px;font-weight:800;color:${color};">${esc(value)}</div>` +
    lines.map(line => `<div style="font-size:12px;color:var(--text-muted);">${esc(line)}</div>`).join('');
  card.appendChild(body);
  card.querySelector('button').onclick = () => showRaw(raw, payload);
  return card;
}

function findingHtml(finding) {
  const fix = (finding.code === 'workspace_unavailable' && finding.workspace)
    ? `<br><a href="#workspaces" style="color:var(--blue);text-decoration:none;font-weight:600;">Fix in Workspaces</a>`
    : '';
  return `<div style="font-size:12px;color:var(--text-muted);"><strong style="color:var(--text);">${esc(finding.code || finding.severity || 'finding')}</strong><br>${esc(finding.message || '')}${fix}</div>`;
}

function aliasConsistencyCard(data, raw) {
  const card = document.createElement('div');
  card.className = 'card';
  const workspaces = Array.isArray(data?.workspaces) ? data.workspaces : [];
  const staleCount = workspaces.reduce((n, ws) => n + (ws.staleKeys?.length || 0), 0);
  const value = aliasStatusValue(data, staleCount);
  const valueColor = aliasStatusColor(data, staleCount);
  card.innerHTML = `<div class="card-head"><h3>Validation commands</h3><button class="secondary" style="min-height:24px;padding:0 8px;font-size:11px;">Details</button></div>`;
  const body = document.createElement('div');
  body.className = 'card-body';
  body.style.display = 'grid';
  body.style.gap = '8px';
  const rows = workspaces.length
    ? workspaces.map(ws => {
        if (!ws.staleKeys?.length) {
          return `<div style="font-size:12px;color:var(--text-muted);">${esc(ws.alias)}: ${ws.configuredKeys?.length || 0} configured command${pluralSuffix(ws.configuredKeys?.length || 0)} valid</div>`;
        }
        return `<div style="font-size:12px;color:var(--text-muted);"><strong style="color:var(--red);">${esc(ws.alias)}</strong>: stale - ${esc(ws.staleKeys.join(', '))}</div>`;
      }).join('')
    : '<div style="font-size:12px;color:var(--text-muted);">No workspaces configured.</div>';
  body.innerHTML = `<div style="font-size:22px;font-weight:800;color:${valueColor};">${esc(value)}</div>${rows}`;
  card.appendChild(body);
  card.querySelector('button').onclick = () => showRaw(raw, data);
  return card;
}

function aliasStatusValue(data, staleCount) {
  if (data == null) return 'Unknown';
  return staleCount === 0 ? 'All valid' : staleCount + ' stale';
}

function aliasStatusColor(data, staleCount) {
  if (data == null) return 'var(--text-muted)';
  return staleCount === 0 ? 'var(--green)' : 'var(--red)';
}

function cautionEscalationsCard(data, raw) {
  const workspaces = Array.isArray(data?.workspaces) ? data.workspaces : [];
  const total = workspaces.reduce((n, w) => n + (Number.isFinite(w.count) ? w.count : 0), 0);
  if (data && total === 0) return null;
  const value = data == null ? 'Unknown' : total + ' recent change' + pluralSuffix(total);
  const windowHours = Number.isFinite(data?.windowHours) ? data.windowHours : 24;
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h3>Protected config changes</h3><button class="secondary" style="min-height:24px;padding:0 8px;font-size:11px;">Details</button></div>`;
  const body = document.createElement('div');
  body.className = 'card-body';
  body.style.display = 'grid';
  body.style.gap = '8px';
  const rows = workspaces.length
    ? workspaces.map((w) => {
        const recent = Array.isArray(w.recent) ? w.recent : [];
        const recentHtml = recent.slice(0, 3).map(recentChangeHtml).join('');
        return `<div style="font-size:12px;color:var(--text-muted);"><strong style="color:var(--text);">${esc(w.alias)}</strong>: ${esc(w.count)} protected change${pluralSuffix(w.count)} in ${esc(windowHours)}h</div>${recentHtml}`;
      }).join('')
    : '<div style="font-size:12px;color:var(--text-muted);">No protected configuration changes in the current window.</div>';
  body.innerHTML = `<div style="font-size:22px;font-weight:800;color:var(--yellow);">${esc(value)}</div>${rows}`;
  card.appendChild(body);
  card.querySelector('button').onclick = () => showRaw(raw, data);
  return card;
}

function pluralSuffix(count) {
  return count === 1 ? '' : 's';
}

function recentChangeHtml(change) {
  const reason = change.reason ? ' - ' + esc(change.reason) : '';
  return `<div style="font-size:11px;color:var(--text-muted);">Changed by ${esc(change.tool || 'workspace tool')}${reason}</div>`;
}

function showRaw(raw, payload) {
  raw.style.display = 'block';
  raw.textContent = JSON.stringify(payload, null, 2);
}
