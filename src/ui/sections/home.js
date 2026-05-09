// Home section — Phase 2: pending approvals above fold, live-work card, health surfacing
import { fetchJson, postJson } from '/ui/api.js';
import { pillHtml } from '/ui/components/pill.js';
import { toast } from '/ui/components/toast.js';

export function mountHome(container, data) {
  if (!data) return;
  container.innerHTML = '';
  container.appendChild(_buildHome(data));
}

function _buildHome(data) {
  const cfg = data.config || {};
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const approvals = Array.isArray(data.approvals) ? data.approvals : [];
  const health = data.health || {};
  const findings = Array.isArray(health.findings) ? health.findings : [];
  const audit = (data.auditTail && Array.isArray(data.auditTail.entries)) ? data.auditTail.entries : [];
  const readiness = data.readiness || {};
  const counts = data.counts || {};
  const locks = Array.isArray(data.locks) ? data.locks : [];

  const openApprovals = approvals.filter(x => !['approved', 'denied', 'resolved', 'cancelled'].includes(String(x.status || '').toLowerCase()));
  const activeSessions = sessions.filter(x => !['completed', 'closed', 'cancelled', 'failed'].includes(String(x.status || '').toLowerCase()));
  const runningJobs = jobs.filter(x => ['running', 'cancelling', 'queued'].includes(String(x.status || '').toLowerCase()));

  const root = document.createElement('div');
  root.className = 'section';
  root.style.gap = '16px';

  // Topbar subtitle (topbar is outside <main>, still in DOM)
  const subtitle = document.getElementById('subtitle');
  if (subtitle) subtitle.textContent = 'Rel.AI MCP' + (cfg.permissionProfile ? ' · ' + cfg.permissionProfile + ' profile' : '') + ' · ' + (Array.isArray(cfg.workspaces) ? cfg.workspaces.length : 0) + ' workspaces';
  const updated = document.getElementById('lastUpdated');
  if (updated) updated.textContent = 'Updated ' + new Date().toLocaleTimeString();
  const statusEl = document.getElementById('serverStatus');
  if (statusEl) { statusEl.className = 'status-pill ' + (data.ok ? 'ok' : 'bad'); statusEl.textContent = data.ok ? 'Online' : 'Error'; }

  // Health warning above fold
  if (health.ok === false && findings.length) {
    const healthBanner = document.createElement('div');
    healthBanner.style.cssText = 'padding:12px 14px;border:1px solid rgba(255,102,128,.35);border-radius:12px;background:rgba(255,102,128,.08);color:#ffb3c0;font-size:13px;display:flex;gap:10px;align-items:flex-start;';
    healthBanner.innerHTML = `<span style="font-size:16px;">⚠</span><div><strong>Health findings (${findings.length})</strong><div style="margin-top:4px;color:#ff9aaa;">${findings.slice(0, 3).map(f => esc(f.message || f.code || 'finding')).join(' · ')}</div></div>`;
    root.appendChild(healthBanner);
  }

  // Pending approvals card
  if (openApprovals.length) {
    const apprCard = document.createElement('div');
    apprCard.className = 'card';
    apprCard.style.border = '1px solid rgba(255,194,75,.35)';
    apprCard.innerHTML = `<div class="card-head" style="border-bottom-color:rgba(255,194,75,.2);"><h3>Pending approvals (${openApprovals.length})</h3></div>`;
    const body = document.createElement('div');
    body.className = 'card-body';
    body.style.display = 'grid';
    body.style.gap = '8px';
    for (const appr of openApprovals.slice(0, 5)) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border:1px solid rgba(255,194,75,.15);border-radius:10px;background:rgba(255,194,75,.04);';
      row.innerHTML = `<div><div style="font-weight:700;font-size:13px;">⚠ ${esc(appr.action || 'approval')}</div><div style="color:var(--text-muted);font-size:12px;margin-top:2px;">${esc(appr.workspace || '')} · ${timeAgo(appr.createdAt)}</div></div>`;
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:8px;flex-shrink:0;';
      const approveBtn = document.createElement('button');
      approveBtn.textContent = 'Approve';
      approveBtn.style.cssText = 'min-height:30px;padding:0 12px;font-size:12px;background:rgba(71,221,138,.12);border-color:rgba(71,221,138,.35);';
      approveBtn.onclick = () => _decideApproval(appr.id, 'approved', row);
      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'danger';
      rejectBtn.textContent = 'Reject';
      rejectBtn.style.cssText = 'min-height:30px;padding:0 12px;font-size:12px;';
      rejectBtn.onclick = () => _decideApproval(appr.id, 'rejected', row);
      btns.appendChild(approveBtn);
      btns.appendChild(rejectBtn);
      row.appendChild(btns);
      body.appendChild(row);
    }
    apprCard.appendChild(body);
    root.appendChild(apprCard);
  }

  // Metrics grid
  const metricsGrid = document.createElement('div');
  metricsGrid.className = 'overview-grid';
  metricsGrid.innerHTML =
    _metric('Sessions', counts.sessions || sessions.length, activeSessions.length + ' active', 'blue') +
    _metric('Jobs', counts.jobs || jobs.length, runningJobs.length + ' running', 'warn') +
    _metric('Approvals', counts.approvals || approvals.length, openApprovals.length + ' open', openApprovals.length ? 'warn' : 'purple') +
    _metric('Locks', counts.locks || locks.length, 'cooperative locks', 'blue') +
    _metric('Health', findings.length, health.ok === false ? 'needs attention' : 'all clear', health.ok === false ? 'bad' : 'good') +
    _metric('Readiness', readiness.score != null ? readiness.score : '—', readiness.ok === false ? 'review needed' : 'release check', readiness.ok === false ? 'warn' : 'good');
  root.appendChild(metricsGrid);

  // Live work + Recent activity (two-column)
  const lowerGrid = document.createElement('div');
  lowerGrid.className = 'layout-grid';

  const liveCard = document.createElement('div');
  liveCard.className = 'card';
  liveCard.innerHTML = '<div class="card-head"><h3>Live work</h3></div>';
  const liveBody = document.createElement('div');
  liveBody.className = 'card-body list';
  const liveItems = [
    ...activeSessions.slice(0, 4).map(s => _listItem(short(s.id), (s.workspace || 'workspace') + ' · ' + (s.status || 'unknown'), timeAgo(s.updatedAt || s.createdAt), s.status)),
    ...runningJobs.slice(0, 3).map(j => _listItem(short(j.id), (j.workspace || 'workspace') + ' · ' + (j.commandKey || j.command || 'job'), timeAgo(j.updatedAt || j.startedAt), j.status)),
  ];
  liveBody.innerHTML = liveItems.join('') || '<div class="empty">No active sessions or jobs.</div>';
  liveCard.appendChild(liveBody);

  const actCard = document.createElement('div');
  actCard.className = 'card';
  actCard.innerHTML = `<div class="card-head"><h3>Recent activity (${audit.length})</h3></div>`;
  const actBody = document.createElement('div');
  actBody.className = 'card-body';
  actBody.innerHTML = audit.slice(0, 12).map(x => {
    const ok = x.ok === false ? 'failed' : 'ok';
    return `<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--line-soft);font-size:12px;"><span style="color:var(--text-muted);white-space:nowrap;">${esc(timeAgo(x.ts || x.at))}</span><span class="truncate mono" style="flex:1;">${esc(x.tool || x.type || 'activity')}</span>${pillHtml(ok)}</div>`;
  }).join('') || '<div class="empty">Activity will appear here when ChatGPT calls a Rel.AI tool.</div>';
  actCard.appendChild(actBody);

  lowerGrid.appendChild(liveCard);
  lowerGrid.appendChild(actCard);
  root.appendChild(lowerGrid);

  return root;
}

async function _decideApproval(id, status, rowEl) {
  rowEl.style.opacity = '0.5';
  rowEl.style.pointerEvents = 'none';
  const result = await postJson(`/api/approvals/${encodeURIComponent(id)}/decision`, { status });
  if (result && result.ok) {
    toast(status === 'approved' ? 'Approved — agent can now retry.' : 'Rejected.', { variant: status === 'approved' ? 'success' : 'warn' });
    try { await navigator.clipboard.writeText(id); } catch (_) {}
    rowEl.remove();
  } else {
    rowEl.style.opacity = '';
    rowEl.style.pointerEvents = '';
    toast('Error: ' + (result ? result.error : 'unknown'), { variant: 'error' });
  }
}

function _metric(label, value, meta, type) { return `<div class="metric ${type || ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-meta">${esc(meta || '')}</div></div>`; }
function _listItem(title, sub, time, state) { const c = _cls(state || 'ok'); return `<div class="list-item"><span class="dot ${c === 'ok' ? '' : c}"></span><div><div class="item-title">${esc(title)}</div><div class="item-sub">${esc(sub || '')}</div></div><div class="item-time">${esc(time || '')}</div></div>`; }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function _cls(v) { const s = String(v || '').toLowerCase(); return s.includes('fail') || s.includes('error') || s.includes('denied') || s === 'false' ? 'bad' : s.includes('pending') || s.includes('run') || s.includes('warn') || s.includes('active') ? 'warn' : 'ok'; }
function short(v) { const s = String(v || ''); return s.length > 20 ? s.slice(0, 10) + '…' + s.slice(-5) : s; }
function timeAgo(v) { const ts = Date.parse(String(v || '')); if (!Number.isFinite(ts)) return ''; const m = Math.floor(Math.max(0, Date.now() - ts) / 60000); if (m < 1) return 'now'; if (m < 60) return m + 'm ago'; const h = Math.floor(m / 60); return h < 24 ? h + 'h ago' : Math.floor(h / 24) + 'd ago'; }
