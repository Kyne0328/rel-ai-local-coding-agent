// Workspaces section — configured repositories, health, and command surface
import { fetchJson } from '/ui/api.js';
import { pillHtml } from '/ui/components/pill.js';
import { badgeHtml } from '/ui/components/badge.js';
import { esc, metricHtml, statusClass } from '/ui/utils.js';


export function mountWorkspaces(container, data) {
  container.innerHTML = '';
  container.appendChild(_buildWorkspaces(data || {}));
}

function _buildWorkspaces(data) {
  const cfg = data.config || {};
  const health = data.health || {};
  const readiness = data.readiness || {};
  const workspaces = Array.isArray(cfg.workspaces) ? cfg.workspaces : [];
  const healthByAlias = new Map((Array.isArray(health.workspaces) ? health.workspaces : []).map(item => [item.alias, item]));

  const root = document.createElement('div');
  root.className = 'section';
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Workspaces</h2><p>Configured repositories, command allowlists, worktrees, and health status.</p></div>
      <span class="section-action">${esc(workspaces.length)} configured</span>
    </div>
    <div class="overview-grid">
      ${metricHtml('Workspaces', workspaces.length, 'configured aliases', 'blue')}
      ${metricHtml('Health findings', Array.isArray(health.findings) ? health.findings.length : 0, health.ok === false ? 'needs attention' : 'all clear', health.ok === false ? 'bad' : 'good')}
      ${metricHtml('Readiness', readiness.score != null ? readiness.score : '—', readiness.rating || 'release check', readiness.ok === false ? 'warn' : 'good')}
      ${metricHtml('Permission profile', cfg.permissionProfile || 'unknown', 'effective config', 'purple')}
    </div>
  `;

  const grid = document.createElement('div');
  grid.className = 'workspace-grid';
  grid.innerHTML = workspaces.length ? workspaces.map(ws => _workspaceCard(ws, healthByAlias.get(ws.alias))).join('') : '<div class="empty">No workspaces configured.</div>';
  root.appendChild(grid);

  const findingsCard = document.createElement('div');
  findingsCard.className = 'card';
  findingsCard.innerHTML = '<div class="card-head"><h3>Workspace health findings</h3><span class="section-action">from health monitor</span></div>';
  const findingsBody = document.createElement('div');
  findingsBody.className = 'card-body list';
  const findings = Array.isArray(health.findings) ? health.findings : [];
  findingsBody.innerHTML = findings.length ? findings.map(_findingRow).join('') : '<div class="empty">No workspace health findings.</div>';
  findingsCard.appendChild(findingsBody);
  root.appendChild(findingsCard);

  return root;
}

function _workspaceCard(ws, health) {
  const testKeys = Array.isArray(ws.testCommandKeys) ? ws.testCommandKeys : [];
  const commandKeys = Array.isArray(ws.commandKeys) ? ws.commandKeys : [];
  const protectedBranches = Array.isArray(ws.protectedBranches) ? ws.protectedBranches : [];
  const status = health && health.ok === false ? 'check' : 'healthy';
  return `
    <div class="workspace-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <strong>${esc(ws.alias || 'workspace')}</strong>
        ${pillHtml(status)}
      </div>
      <div class="path">${esc(ws.path || '')}</div>
      <div class="badge-row">
        ${badgeHtml('tests ' + testKeys.length)}
        ${badgeHtml('commands ' + commandKeys.length)}
        ${badgeHtml('worktrees ' + (health && health.worktreeCount != null ? health.worktreeCount : 0))}
        ${badgeHtml('protected ' + (protectedBranches.join(', ') || 'none'))}
      </div>
      ${testKeys.length ? `<div class="path">Test commands: ${esc(testKeys.join(', '))}</div>` : '<div class="path">No test commands configured.</div>'}
      ${commandKeys.length ? `<div class="path">Dev commands: ${esc(commandKeys.join(', '))}</div>` : ''}
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="secondary" type="button" data-preflight="${esc(ws.alias || '')}">Run preflight</button>
      </div>
      <pre class="copy-box" data-preflight-out="${esc(ws.alias || '')}" style="display:none;margin-top:10px;max-height:220px;overflow:auto;"></pre>
    </div>`;
}

function _findingRow(finding) {
  return `<div class="list-item"><span class="dot ${statusClass(finding.severity)}"></span><div><div class="item-title">${esc(finding.code || finding.severity || 'finding')}</div><div class="item-sub">${esc(finding.message || '')}</div></div><div class="item-time">${pillHtml(finding.severity || 'info')}</div></div>`;
}

document.addEventListener('click', async (event) => {
  const btn = event.target && event.target.closest ? event.target.closest('[data-preflight]') : null;
  if (!btn) return;
  const alias = btn.getAttribute('data-preflight') || '';
  const out = _preflightOutput(alias);
  btn.disabled = true;
  btn.textContent = 'Running…';
  const result = await fetchJson('/api/workspace/preflight?workspace=' + encodeURIComponent(alias) + '&requireClean=0');
  if (out) { out.style.display = 'block'; out.textContent = JSON.stringify(result, null, 2); }
  btn.disabled = false;
  btn.textContent = 'Run preflight';
});

function _preflightOutput(alias) {
  return Array.from(document.querySelectorAll('[data-preflight-out]')).find(el => el.getAttribute('data-preflight-out') === alias) || null;
}

