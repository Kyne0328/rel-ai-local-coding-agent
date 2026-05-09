// Home section — ported from httpServer.js render* functions
// Same DOM IDs as current template; no routing in Phase 1

export function boot(data) {
  if (!data) return;
  render(data);
}

function render(data) {
  const ok = Boolean(data && data.ok);
  const statusEl = document.getElementById('serverStatus');
  if (statusEl) { statusEl.className = 'status-pill ' + (ok ? 'ok' : 'bad'); statusEl.textContent = ok ? 'Online' : 'Error'; }
  const subtitleEl = document.getElementById('subtitle');
  if (subtitleEl) subtitleEl.textContent = ok ? 'Rel.AI MCP ' + (data.config && data.config.permissionProfile ? '· ' + data.config.permissionProfile + ' profile' : '') : 'Could not load dashboard data';
  const updatedEl = document.getElementById('lastUpdated');
  if (updatedEl) updatedEl.textContent = 'Updated ' + new Date().toLocaleTimeString();

  const cfg = data.config || {};
  const counts = data.counts || {};
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const approvals = Array.isArray(data.approvals) ? data.approvals : [];
  const locks = Array.isArray(data.locks) ? data.locks : [];
  const health = data.health || {};
  const findings = Array.isArray(health.findings) ? health.findings : [];
  const audit = (data.auditTail && Array.isArray(data.auditTail.entries)) ? data.auditTail.entries : [];
  const subtasks = (data.multiAgent && Array.isArray(data.multiAgent.subtasks)) ? data.multiAgent.subtasks : [];
  const readiness = data.readiness || {};

  const activeSessions = sessions.filter(x => !['completed', 'closed', 'cancelled', 'failed'].includes(String(x.status || '').toLowerCase())).length;
  const runningJobs = jobs.filter(x => ['running', 'cancelling', 'queued'].includes(String(x.status || '').toLowerCase())).length;
  const openApprovals = approvals.filter(x => !['approved', 'denied', 'resolved', 'cancelled'].includes(String(x.status || '').toLowerCase())).length;

  const metricsEl = document.getElementById('metrics');
  if (metricsEl) metricsEl.innerHTML =
    metric('Sessions', counts.sessions || sessions.length, activeSessions + ' active', 'blue') +
    metric('Jobs', counts.jobs || jobs.length, runningJobs + ' running', 'warn') +
    metric('Approvals', counts.approvals || approvals.length, openApprovals + ' open', openApprovals ? 'warn' : 'purple') +
    metric('Locks', counts.locks || locks.length, 'cooperative locks', 'blue') +
    metric('Health', findings.length, health.ok === false ? 'needs attention' : 'all clear', health.ok === false ? 'bad' : 'good') +
    metric('Readiness', readiness.score != null ? readiness.score : '—', readiness.ok === false ? 'review needed' : 'release check', readiness.ok === false ? 'warn' : 'good');

  renderConfig(cfg, data);
  renderWorkspaces(cfg, health);
  renderActivity(audit);
  renderLists(sessions, jobs, approvals, findings);
  renderTerminal(data, audit, jobs, subtasks, findings);
  renderAgents(subtasks, jobs, approvals, health);
}

function renderConfig(cfg, data) {
  const profile = cfg.permissionProfile || 'unknown';
  const pill = document.getElementById('profilePill');
  if (pill) { pill.className = 'status-pill ' + (profile === 'admin' ? 'warn' : 'ok'); pill.textContent = profile + ' profile'; }
  const configItems = [
    ['State dir', cfg.stateDir || 'not reported', 'ok'],
    ['Dashboard', cfg.dashboardEnabled === false ? 'disabled' : 'enabled', cfg.dashboardEnabled === false ? 'bad' : 'ok'],
    ['Arbitrary commands', cfg.allowArbitraryCommands ? 'enabled' : 'disabled', cfg.allowArbitraryCommands ? 'warn' : 'ok'],
    ['Docker', cfg.allowDocker ? 'enabled' : 'disabled', cfg.allowDocker ? 'warn' : 'ok'],
    ['GitHub CLI', cfg.allowGitHubCli ? 'enabled' : 'disabled', cfg.allowGitHubCli ? 'warn' : 'ok'],
    ['Multi-agent', cfg.multiAgent && cfg.multiAgent.enabled ? 'enabled' : 'disabled', cfg.multiAgent && cfg.multiAgent.enabled ? 'ok' : 'warn'],
  ];
  const el = document.getElementById('configList');
  if (el) el.innerHTML = configItems.map(x => listItem(x[0], x[1], '', x[2])).join('') || emptyHtml('No configuration summary available.');
}

function renderWorkspaces(cfg, health) {
  const workspaces = Array.isArray(cfg.workspaces) ? cfg.workspaces : [];
  const healthWorkspaces = Array.isArray(health.workspaces) ? health.workspaces : [];
  const countEl = document.getElementById('workspaceCount');
  if (countEl) countEl.textContent = workspaces.length + ' configured';
  const firstWs = workspaces[0];
  const wsInput = document.getElementById('workspace');
  if (wsInput && firstWs && !wsInput.value) wsInput.value = firstWs.alias || '';
  const listEl = document.getElementById('workspacesList');
  if (!listEl) return;
  if (!workspaces.length) {
    listEl.innerHTML = '';
    listEl.appendChild(createEmptyState());
    return;
  }
  listEl.innerHTML = workspaces.map(w => {
    const h = healthWorkspaces.find(x => x.alias === w.alias) || {};
    const badges = [
      `<span class="badge ${h.ok === false ? 'warn' : 'good'}">${h.ok === false ? 'check' : 'healthy'}</span>`,
      `<span class="badge">base ${esc(w.defaultBaseBranch || 'main')}</span>`,
      `<span class="badge">tests ${esc((w.testCommandKeys || []).length)}</span>`,
      h.worktreeCount != null ? `<span class="badge">worktrees ${esc(h.worktreeCount)}</span>` : '',
    ].join('');
    return `<div class="workspace-card"><strong>${esc(w.alias || 'workspace')}</strong><div class="path">${esc(w.path || '')}</div><div class="badge-row">${badges}</div></div>`;
  }).join('');
}

function createEmptyState() {
  const el = document.createElement('div');
  el.className = 'empty';
  el.style.cssText = 'text-align:center;padding:32px 16px;display:grid;gap:8px;';
  el.innerHTML = '<div style="font-size:24px;">📁</div><div style="font-weight:700;">No workspaces yet</div><div style="color:var(--muted,var(--text-muted));font-size:13px;">Point Rel.AI at a folder to get started</div>';
  return el;
}

function renderActivity(audit) {
  const countEl = document.getElementById('activityCount');
  if (countEl) countEl.textContent = audit.length + ' events';
  const tbody = document.getElementById('activityRows');
  if (!tbody) return;
  tbody.innerHTML = audit.slice(0, 12).map(x => {
    const ok = x.ok === false ? 'failed' : 'ok';
    const message = x.error || x.message || x.path || '';
    return `<tr><td class="nowrap">${esc(timeAgo(x.ts || x.at || x.createdAt || x.timestamp))}</td><td class="truncate mono">${esc(x.tool || x.type || x.event || 'activity')}</td><td class="truncate">${esc(x.workspace || '—')}</td><td><span class="status-pill ${cls(ok)}">${esc(ok)}<span class="sr-only"> (${cls(ok)})</span></span></td><td class="truncate">${esc(message)}</td></tr>`;
  }).join('') || `<tr><td colspan="5"><div class="empty">Activity will appear here when ChatGPT calls a Rel.AI tool.</div></td></tr>`;
}

function renderLists(sessions, jobs, approvals, findings) {
  const set = (id, items, mapFn, emptyMsg) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = items.slice(0, 8).map(mapFn).join('') || emptyHtml(emptyMsg);
  };
  const cnt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
  cnt('sessionCount', sessions.length);
  cnt('jobCount', jobs.length);
  cnt('approvalCount', approvals.length);
  cnt('findingCount', findings.length);
  set('sessionsList', sessions, x => listItem(short(x.id), String(x.workspace || 'workspace') + ' · ' + String(x.status || 'unknown'), timeAgo(x.updatedAt || x.createdAt), x.status), 'No task sessions yet.');
  set('jobsList', jobs, x => listItem(short(x.id), String(x.workspace || 'workspace') + ' · ' + String(x.commandKey || x.command || 'command'), timeAgo(x.updatedAt || x.startedAt || x.createdAt), x.status), 'No background jobs.');
  set('approvalsList', approvals, x => listItem(short(x.id), String(x.action || 'approval') + ' · ' + String(x.status || 'pending'), timeAgo(x.updatedAt || x.createdAt), x.status || 'pending'), 'No pending approvals.');
  set('healthList', findings, x => listItem(x.code || x.severity || 'finding', x.message || '', '', x.severity || 'warn'), 'No health findings.');
}

function renderTerminal(data, audit, jobs, subtasks, findings) {
  const el = document.getElementById('terminal');
  if (!el) return;
  const lines = [];
  lines.push('<span class="prompt">$</span> relai dashboard');
  if (data && data.ok) lines.push('<span class="ok">✓</span> server responded');
  else lines.push('<span class="bad">✕</span> ' + esc(data && data.error ? data.error : 'failed to load'));
  lines.push('<span class="ok">✓</span> sessions ' + esc((data.sessions || []).length) + ', jobs ' + esc((data.jobs || []).length) + ', approvals ' + esc((data.approvals || []).length));
  if (subtasks.length) lines.push('<span class="ok">✓</span> subtasks tracked: ' + esc(subtasks.length));
  if (findings.length) lines.push('<span class="warn">!</span> health findings: ' + esc(findings.length));
  else lines.push('<span class="ok">✓</span> health findings: 0');
  if (audit[0]) lines.push('<span class="prompt">›</span> latest ' + esc(audit[0].tool || 'activity') + ' ' + esc(timeAgo(audit[0].ts || audit[0].at || audit[0].createdAt)));
  el.innerHTML = lines.join('<br>');
}

function renderAgents(subtasks, jobs, approvals, health) {
  const AGENTS = [
    ['Planner', 'Plans tasks', '♙'], ['Implementer', 'Applies changes', '⌘'],
    ['Tester', 'Runs checks', '✓'], ['Reviewer', 'Reviews diffs', '◆'],
    ['CI Repair', 'Watches checks', '◈'], ['Docs', 'Updates notes', '✎'], ['Security', 'Flags risk', '▰'],
  ];
  const el = document.getElementById('agentGrid');
  if (!el) return;
  const cnt = document.getElementById('agentCount');
  if (cnt) cnt.textContent = AGENTS.length + ' roles';
  el.innerHTML = AGENTS.map(role => {
    const [label, fallback, icon] = role;
    const match = subtasks.find(x => String(x.role || '').toLowerCase().includes(label.toLowerCase().split(' ')[0]));
    let state = match ? String(match.status || fallback) : fallback;
    if (label === 'Tester' && jobs.some(x => String(x.commandKey || x.command || '').toLowerCase().includes('test'))) state = 'Running tests';
    if (label === 'Reviewer' && approvals.length) state = 'Reviewing gates';
    if (label === 'Security' && health && health.ok === false) state = 'Needs attention';
    return `<div class="agent"><div class="agent-top"><span class="agent-icon">${esc(icon)}</span><span class="status-pill ${cls(state)}">${esc(state)}<span class="sr-only"> (${cls(state)})</span></span></div><div class="agent-name">${esc(label)}</div><div class="agent-state">${esc(state)}</div></div>`;
  }).join('');
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function cls(v) { const s = String(v || '').toLowerCase(); return s.includes('fail') || s.includes('error') || s.includes('denied') || s.includes('blocked') || s === 'false' ? 'bad' : s.includes('pending') || s.includes('run') || s.includes('warn') || s.includes('wait') || s.includes('active') ? 'warn' : 'ok'; }
function short(v) { const s = String(v || ''); return s.length > 28 ? s.slice(0, 14) + '…' + s.slice(-7) : s; }
function timeAgo(v) { const ts = Date.parse(String(v || '')); if (!Number.isFinite(ts)) return String(v || ''); const m = Math.floor(Math.max(0, Date.now() - ts) / 60000); if (m < 1) return 'now'; if (m < 60) return m + 'm ago'; const h = Math.floor(m / 60); if (h < 24) return h + 'h ago'; return Math.floor(h / 24) + 'd ago'; }
function metric(label, value, meta, type) { return `<div class="metric ${type || ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-meta">${esc(meta || '')}</div></div>`; }
function listItem(title, sub, time, state) { const c = cls(state || 'ok'); return `<div class="list-item"><span class="dot ${c === 'ok' ? '' : c}"></span><div><div class="item-title">${esc(title)}</div><div class="item-sub">${esc(sub || '')}</div></div><div class="item-time">${esc(time || '')}</div></div>`; }
function emptyHtml(msg) { return `<div class="empty">${esc(msg)}</div>`; }
