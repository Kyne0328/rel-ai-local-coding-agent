// Agents section — role overview plus live multi-agent subtask binding
import { pillHtml } from '/ui/components/pill.js';

export function boot(_data) { /* no-op */ }

export function mountAgents(container, data) {
  container.innerHTML = '';
  container.appendChild(_buildAgents(data || {}));
}

function _buildAgents(data) {
  const multi = data.multiAgent || {};
  const subtasks = Array.isArray(multi.subtasks) ? multi.subtasks : [];
  const counts = multi.counts || {};
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const approvals = Array.isArray(data.approvals) ? data.approvals : [];
  const health = data.health || {};
  const cfg = data.config || {};
  const roles = ((cfg.multiAgent && Array.isArray(cfg.multiAgent.defaultRoles)) ? cfg.multiAgent.defaultRoles : ['planner', 'implementer', 'tester', 'reviewer']).map(String);

  const openApprovals = approvals.filter(x => !['approved', 'rejected', 'denied', 'resolved', 'cancelled'].includes(String(x.status || '').toLowerCase()));
  const activeSessions = sessions.filter(x => !['completed', 'closed', 'cancelled', 'failed'].includes(String(x.status || '').toLowerCase()));
  const runningJobs = jobs.filter(x => ['running', 'cancelling', 'queued'].includes(String(x.status || '').toLowerCase()));

  const root = document.createElement('div');
  root.className = 'section';
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Agents</h2><p>Multi-agent roles, subtasks, dependencies, and execution state.</p></div>
      <span class="section-action">${esc(subtasks.length)} subtasks</span>
    </div>
    <div class="overview-grid">
      ${_metric('Configured roles', roles.length, 'default multi-agent roles', 'blue')}
      ${_metric('Subtasks', subtasks.length, _countSummary(counts), 'purple')}
      ${_metric('Active sessions', activeSessions.length, 'not closed or completed', activeSessions.length ? 'warn' : 'good')}
      ${_metric('Running jobs', runningJobs.length, 'queued/running/cancelling', runningJobs.length ? 'warn' : 'good')}
      ${_metric('Open approvals', openApprovals.length, 'agent gates', openApprovals.length ? 'warn' : 'good')}
      ${_metric('Health', Array.isArray(health.findings) ? health.findings.length : 0, health.ok === false ? 'needs attention' : 'all clear', health.ok === false ? 'bad' : 'good')}
    </div>
  `;

  const roleCard = document.createElement('div');
  roleCard.className = 'card';
  roleCard.innerHTML = '<div class="card-head"><h3>Role status</h3><span class="section-action">derived from live state</span></div>';
  const roleBody = document.createElement('div');
  roleBody.className = 'card-body';
  roleBody.innerHTML = `<div class="agent-grid">${roles.map(role => _roleCard(role, subtasks, { openApprovals, runningJobs, health })).join('')}</div>`;
  roleCard.appendChild(roleBody);
  root.appendChild(roleCard);

  const taskCard = document.createElement('div');
  taskCard.className = 'card';
  taskCard.innerHTML = '<div class="card-head"><h3>Recent subtasks</h3><span class="section-action">latest first</span></div>';
  const taskBody = document.createElement('div');
  taskBody.className = 'card-body list';
  taskBody.innerHTML = subtasks.length ? subtasks.slice(0, 30).map(_subtaskRow).join('') : '<div class="empty">No multi-agent subtasks yet. Split a task to populate this view.</div>';
  taskCard.appendChild(taskBody);
  root.appendChild(taskCard);

  return root;
}

function _roleCard(role, subtasks, state) {
  const normalized = String(role).toLowerCase();
  const items = subtasks.filter(item => String(item.role || '').toLowerCase() === normalized);
  const latest = items[0] || null;
  let label = latest ? latest.status : 'ready';
  if (normalized.includes('review') && state.openApprovals.length) label = 'approval gates';
  if (normalized.includes('test') && state.runningJobs.length) label = 'jobs running';
  if (normalized.includes('security') && state.health.ok === false) label = 'health findings';
  return `<div class="agent"><div class="agent-top"><span class="agent-icon">${esc(role.charAt(0).toUpperCase())}</span>${pillHtml(label)}</div><div class="agent-name">${esc(_title(role))}</div><div class="agent-state">${esc(items.length ? items.length + ' subtask(s)' : 'No assigned subtasks')}</div></div>`;
}

function _subtaskRow(item) {
  const deps = Array.isArray(item.dependsOn) && item.dependsOn.length ? ' · depends on ' + item.dependsOn.join(', ') : '';
  return `<div class="list-item"><span class="dot ${_cls(item.status)}"></span><div><div class="item-title">${esc(item.title || item.id || 'subtask')}</div><div class="item-sub">${esc((item.role || 'agent') + ' · ' + (item.workspace || 'workspace') + deps)}</div></div><div class="item-time">${pillHtml(item.status || 'created')}</div></div>`;
}

function _metric(label, value, meta, type) { return `<div class="metric ${type || ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-meta">${esc(meta || '')}</div></div>`; }
function _countSummary(counts) { const parts = Object.entries(counts || {}).map(([k, v]) => `${k}: ${v}`); return parts.length ? parts.join(', ') : 'no subtask states'; }
function _title(v) { return String(v || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function _cls(v) { const s = String(v || '').toLowerCase(); return s.includes('fail') || s.includes('error') || s.includes('repair') || s.includes('blocked') ? 'bad' : s.includes('pending') || s.includes('run') || s.includes('created') || s.includes('active') || s.includes('paused') ? 'warn' : 'ok'; }
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
