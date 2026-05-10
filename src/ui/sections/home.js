// Home section — simple ChatGPT-local-repo overview
import { pillHtml } from '/ui/components/pill.js';
import { esc, metricHtml, timeAgo } from '/ui/utils.js';

export function mountHome(container, data) {
  if (!data) return;
  container.innerHTML = '';
  container.appendChild(buildHome(data));
}

function buildHome(data) {
  const cfg = data.config || {};
  const health = data.health || {};
  const readiness = data.readiness || {};
  const audit = sortedAudit(data.auditTail && data.auditTail.entries);
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const workspaces = Array.isArray(cfg.workspaces) ? cfg.workspaces : [];
  const findings = Array.isArray(health.findings) ? health.findings.filter(f => f.severity !== 'info') : [];
  const visibleToolCount = '7 bridge tools';
  const staleHours = Number((cfg.productUx && cfg.productUx.staleHours) || health.staleHours || 24);
  const currentSessions = sessions.filter(s => isCurrentWork(s, staleHours));
  const runningJobs = jobs.filter(j => ['running', 'queued', 'cancelling'].includes(String(j.status || '').toLowerCase()) && !isOlderThan(j.updatedAt || j.startedAt, staleHours));

  updateShell(data, cfg);

  const root = document.createElement('div');
  root.className = 'section';
  root.style.gap = '16px';

  const metrics = document.createElement('div');
  metrics.className = 'overview-grid';
  metrics.innerHTML =
    metricHtml('Workspaces', workspaces.length, 'configured repositories', 'blue') +
    metricHtml('ChatGPT tools', visibleToolCount, 'clean local bridge', 'good') +
    metricHtml('Health', findings.length, health.ok === false ? 'needs attention' : 'all clear', health.ok === false ? 'bad' : 'good') +
    metricHtml('Validation', validationSummary(workspaces), 'auto-detected where possible', 'blue') +
    metricHtml('Activity', audit.length, 'recent tool calls', 'purple') +
    metricHtml('Local bridge', 'ready', 'trusted read/write/shell', 'good');
  root.appendChild(metrics);

  const grid = document.createElement('div');
  grid.className = 'layout-grid';
  grid.appendChild(workspaceSetupCard(workspaces));
  grid.appendChild(recentActivityCard(audit));
  root.appendChild(grid);

  const current = currentWorkCard(currentSessions, runningJobs, staleHours);
  root.appendChild(current);

  return root;
}

function updateShell(data, cfg) {
  const subtitle = document.getElementById('subtitle');
  if (subtitle) subtitle.textContent = `Rel.AI MCP · ChatGPT local repo bridge · ${Array.isArray(cfg.workspaces) ? cfg.workspaces.length : 0} workspaces`;
  const updated = document.getElementById('lastUpdated');
  if (updated) updated.textContent = 'Updated ' + new Date().toLocaleTimeString();
  const statusEl = document.getElementById('serverStatus');
  if (statusEl) { statusEl.className = 'status-pill ' + (data.ok ? 'ok' : 'bad'); statusEl.textContent = data.ok ? 'Online' : 'Error'; }
}

function workspaceSetupCard(workspaces) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<div class="card-head"><h3>Workspace setup</h3><span class="section-action">what ChatGPT can use</span></div>';
  const body = document.createElement('div');
  body.className = 'card-body list';
  body.innerHTML = workspaces.length ? workspaces.map(ws => {
    const configured = Array.isArray(ws.testCommandKeys) ? ws.testCommandKeys : [];
    const detected = Array.isArray(ws.discoveredTestCommandKeys) ? ws.discoveredTestCommandKeys : [];
    const status = detected.length || configured.length ? 'ready' : 'check';
    const label = configured.length ? `${configured.length} configured` : detected.length ? `${detected.length} auto-detected` : 'no validation found';
    return `<div class="list-item"><span class="dot ${status === 'ready' ? 'good' : 'warn'}"></span><div><div class="item-title">${esc(ws.alias || 'workspace')}</div><div class="item-sub">${esc(label)}${detected.length ? ' · ' + esc(detected.slice(0, 3).join(', ')) : ''}</div></div><div class="item-time">${pillHtml(status)}</div></div>`;
  }).join('') : '<div class="empty">No workspaces configured yet.</div>';
  card.appendChild(body);
  return card;
}

function recentActivityCard(audit) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h3>Recent activity</h3><span class="section-action">${audit.length} events</span></div>`;
  const body = document.createElement('div');
  body.className = 'card-body';
  body.innerHTML = audit.slice(0, 12).map(x => {
    const ok = x.ok === false ? 'failed' : 'ok';
    return `<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--line-soft);font-size:12px;"><span style="color:var(--text-muted);white-space:nowrap;">${esc(timeAgo(x.ts || x.at || x.createdAt))}</span><span class="truncate mono" style="flex:1;">${esc(x.tool || x.type || 'activity')}</span>${pillHtml(ok)}</div>`;
  }).join('') || '<div class="empty">Activity will appear here when ChatGPT calls Rel.AI.</div>';
  card.appendChild(body);
  return card;
}

function currentWorkCard(sessions, jobs, staleHours) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h3>Current work</h3><span class="section-action">active in last ${staleHours}h</span></div>`;
  const body = document.createElement('div');
  body.className = 'card-body list';
  const rows = [
    ...sessions.slice(0, 4).map(s => row(s.id, `${s.workspace || 'workspace'} · ${s.status || 'active'}`, s.updatedAt || s.createdAt, s.status)),
    ...jobs.slice(0, 4).map(j => row(j.id, `${j.workspace || 'workspace'} · ${j.commandKey || j.command || 'job'}`, j.updatedAt || j.startedAt, j.status))
  ];
  body.innerHTML = rows.join('') || '<div class="empty">No live work. Older stale sessions are hidden from this card and shown only in diagnostics.</div>';
  card.appendChild(body);
  return card;
}

function row(title, sub, ts, status) {
  return `<div class="list-item"><span class="dot"></span><div><div class="item-title">${esc(shortId(title))}</div><div class="item-sub">${esc(sub)}</div></div><div class="item-time">${pillHtml(status || timeAgo(ts))}</div></div>`;
}

function validationSummary(workspaces) {
  const ready = workspaces.filter(ws => (ws.testCommandKeys || []).length || (ws.discoveredTestCommandKeys || []).length).length;
  return `${ready}/${workspaces.length || 0}`;
}

function sortedAudit(entries) {
  return (Array.isArray(entries) ? [...entries] : []).sort((a, b) => Date.parse(b.ts || b.at || b.createdAt || 0) - Date.parse(a.ts || a.at || a.createdAt || 0));
}

function isCurrentWork(item, staleHours) {
  const status = String(item.status || '').toLowerCase();
  if (!['active', 'running', 'queued', 'needs-repair', 'in-progress'].includes(status)) return false;
  return !isOlderThan(item.updatedAt || item.createdAt, staleHours);
}

function isOlderThan(ts, hours) {
  const value = Date.parse(String(ts || ''));
  if (!Number.isFinite(value)) return true;
  return Date.now() - value > hours * 3600000;
}

function shortId(value) {
  const text = String(value || 'work');
  return text.length > 18 ? text.slice(0, 12) + '…' + text.slice(-5) : text;
}
