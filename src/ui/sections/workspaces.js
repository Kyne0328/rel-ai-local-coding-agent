// Workspaces section — configured repositories and validation setup
import { fetchJson, postJson } from '/ui/api.js';
import { pillHtml } from '/ui/components/pill.js';
import { badgeHtml } from '/ui/components/badge.js';
import { toast } from '/ui/components/toast.js';
import { esc, metricHtml, statusClass } from '/ui/utils.js';

export function mountWorkspaces(container, data) {
  container.innerHTML = '';
  container.appendChild(buildWorkspaces(data || {}));
}

function buildWorkspaces(data) {
  const cfg = data.config || {};
  const health = data.health || {};
  const readiness = data.readiness || {};
  const workspaces = Array.isArray(cfg.workspaces) ? cfg.workspaces : [];
  const healthByAlias = new Map((Array.isArray(health.workspaces) ? health.workspaces : []).map(item => [item.alias, item]));
  const validationReady = workspaces.filter(ws => (ws.testCommandKeys || []).length || (ws.discoveredTestCommandKeys || []).length).length;

  const root = document.createElement('div');
  root.className = 'section';
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Workspaces</h2><p>Repositories ChatGPT can read, edit, and verify. In trusted mode, tests can be run automatically from detected project commands.</p></div>
      <span class="section-action">${esc(workspaces.length)} configured</span>
    </div>
    <div class="overview-grid">
      ${metricHtml('Workspaces', workspaces.length, 'configured aliases', 'blue')}
      ${metricHtml('Validation ready', validationReady + '/' + workspaces.length, 'configured or auto-detected', validationReady === workspaces.length ? 'good' : 'warn')}
      ${metricHtml('Health findings', actionableFindings(health).length, health.ok === false ? 'needs attention' : 'all clear', health.ok === false ? 'bad' : 'good')}
      ${metricHtml('ChatGPT tools', '8', 'local bridge', 'good')}
    </div>
  `;

  const grid = document.createElement('div');
  grid.className = 'workspace-grid';
  grid.innerHTML = workspaces.length ? workspaces.map(ws => workspaceCard(ws, healthByAlias.get(ws.alias))).join('') : '<div class="empty">No workspaces configured.</div>';
  root.appendChild(grid);

  const findings = actionableFindings(health);
  if (findings.length) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="card-head"><h3>Health findings</h3><a class="section-action" href="#settings/diagnostics">Open diagnostics</a></div>';
    const body = document.createElement('div');
    body.className = 'card-body list';
    body.innerHTML = findings.map(findingRow).join('');
    card.appendChild(body);
    root.appendChild(card);
  }

  return root;
}

function workspaceCard(ws, health) {
  const testKeys = Array.isArray(ws.testCommandKeys) ? ws.testCommandKeys : [];
  const commandKeys = Array.isArray(ws.commandKeys) ? ws.commandKeys : [];
  const detected = Array.isArray(ws.discoveredTestCommandKeys) ? ws.discoveredTestCommandKeys : [];
  const protectedBranches = Array.isArray(ws.protectedBranches) ? ws.protectedBranches : [];
  const status = health && health.ok === false ? 'check' : 'healthy';
  const canSaveDetected = detected.length && !testKeys.length;
  return `
    <div class="workspace-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <strong>${esc(ws.alias || 'workspace')}</strong>
        ${pillHtml(status)}
      </div>
      <div class="path">${esc(ws.path || '')}</div>
      <div class="badge-row">
        ${badgeHtml('configured tests ' + testKeys.length)}
        ${badgeHtml('detected tests ' + detected.length, detected.length ? 'good' : 'warn')}
        ${badgeHtml('commands ' + commandKeys.length)}
        ${badgeHtml('worktrees ' + (health && health.worktreeCount != null ? health.worktreeCount : 0))}
        ${badgeHtml('protected ' + (protectedBranches.join(', ') || 'none'))}
      </div>
      <div class="path">${validationText(testKeys, detected)}</div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="secondary" type="button" data-preflight="${esc(ws.alias || '')}">Run preflight</button>
        ${canSaveDetected ? `<button type="button" data-save-detected="${esc(ws.alias || '')}">Save detected tests</button>` : ''}
      </div>
      <pre class="copy-box" data-preflight-out="${esc(ws.alias || '')}" style="display:none;margin-top:10px;max-height:220px;overflow:auto;"></pre>
    </div>`;
}

function validationText(configured, detected) {
  if (configured.length) return 'Configured tests: ' + esc(configured.join(', '));
  if (detected.length) return 'Auto-detected validation: ' + esc(detected.join(', ')) + '. ChatGPT can run these via relai_verify even before saving them.';
  return 'No validation commands found yet. ChatGPT can still run explicit shell commands in trusted mode.';
}

function findingRow(finding) {
  return `<a class="list-item" href="#settings/diagnostics" style="text-decoration:none;color:inherit;"><span class="dot ${statusClass(finding.severity)}"></span><div><div class="item-title">${esc(finding.code || finding.severity || 'finding')}</div><div class="item-sub">${esc(finding.message || '')}</div></div><div class="item-time">${pillHtml(finding.severity || 'info')}</div></a>`;
}

document.addEventListener('click', async (event) => {
  const preflight = event.target && event.target.closest ? event.target.closest('[data-preflight]') : null;
  if (preflight) {
    const alias = preflight.getAttribute('data-preflight') || '';
    const out = preflightOutput(alias);
    preflight.disabled = true;
    preflight.textContent = 'Running…';
    const result = await fetchJson('/api/workspace/preflight?workspace=' + encodeURIComponent(alias) + '&requireClean=0');
    if (out) { out.style.display = 'block'; out.textContent = JSON.stringify(result, null, 2); }
    preflight.disabled = false;
    preflight.textContent = 'Run preflight';
    return;
  }

  const saveDetected = event.target && event.target.closest ? event.target.closest('[data-save-detected]') : null;
  if (saveDetected) {
    const alias = saveDetected.getAttribute('data-save-detected') || '';
    saveDetected.disabled = true;
    saveDetected.textContent = 'Saving…';
    const result = await saveDetectedTests(alias);
    saveDetected.disabled = false;
    saveDetected.textContent = 'Save detected tests';
    if (result && result.ok) {
      toast('Detected tests saved for ' + alias + '. Refreshing…', { variant: 'success' });
      setTimeout(() => location.reload(), 500);
    } else {
      toast('Could not save detected tests: ' + ((result && result.error) || 'unknown error'), { variant: 'error' });
    }
  }
});

async function saveDetectedTests(alias) {
  const dashboard = await fetchJson('/api/dashboard/v10?limit=100&requireHttpToken=0');
  const ws = dashboard && dashboard.config && Array.isArray(dashboard.config.workspaces)
    ? dashboard.config.workspaces.find(item => item.alias === alias)
    : null;
  if (!ws) return { ok: false, error: 'workspace not found' };
  const discovered = ws.discoveredCommands || {};
  const keys = Array.isArray(ws.discoveredTestCommandKeys) ? ws.discoveredTestCommandKeys : [];
  const testCommands = {};
  for (const key of keys) if (discovered[key]) testCommands[key] = discovered[key];
  return postJson('/api/workspaces', {
    action: 'upsert',
    alias,
    path: ws.path,
    protectedBranches: ws.protectedBranches,
    defaultBaseBranch: ws.defaultBaseBranch,
    allowedRemotes: ws.allowedRemotes,
    testCommands,
    confirmDangerous: true
  });
}

function preflightOutput(alias) {
  return Array.from(document.querySelectorAll('[data-preflight-out]')).find(el => el.getAttribute('data-preflight-out') === alias) || null;
}

function actionableFindings(health) {
  return Array.isArray(health.findings) ? health.findings.filter(f => f.severity !== 'info') : [];
}
