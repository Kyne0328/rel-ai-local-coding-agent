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
      <div><h2>Workspaces</h2><p>Repositories ChatGPT can inspect, change, validate, review, and restore through the same workspace-tool surface.</p></div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button type="button" data-add-workspace>Add workspace</button>
        <span class="section-action">${esc(workspaces.length)} configured</span>
      </div>
    </div>
    <div class="overview-grid">
      ${metricHtml('Workspaces', workspaces.length, 'configured aliases', 'blue')}
      ${metricHtml('Validation ready', validationReady + '/' + workspaces.length, 'configured or auto-detected', validationReady === workspaces.length ? 'good' : 'warn')}
      ${metricHtml('Health findings', actionableFindings(health).length, health.ok === false ? 'needs attention' : 'all clear', health.ok === false ? 'bad' : 'good')}
      ${metricHtml('ChatGPT tools', '14', 'workspace tools', 'good')}
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
        ${badgeHtml('context mode ' + (ws.fastTask && ws.fastTask.enabled !== false ? 'focused' : 'broad'), ws.fastTask && ws.fastTask.enabled !== false ? 'good' : 'warn')}
        ${badgeHtml('protected ' + (protectedBranches.join(', ') || 'none'))}
      </div>
      <div class="path">${validationText(testKeys, detected)}</div>
      <div class="path">${fastTaskText(ws.fastTask)}</div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="secondary" type="button" data-preflight="${esc(ws.alias || '')}">Run preflight</button>
        <button class="secondary" type="button" data-toggle-fast-task="${esc(ws.alias || '')}">${ws.fastTask && ws.fastTask.enabled !== false ? 'Use broad context' : 'Use focused context'}</button>
        <button class="secondary" type="button" data-edit-fast-task="${esc(ws.alias || '')}">Context settings</button>
        <button class="secondary" type="button" data-rename-workspace="${esc(ws.alias || '')}">Rename</button>
        <button class="secondary danger" type="button" data-clear-workspace="${esc(ws.alias || '')}">Clear</button>
        ${canSaveDetected ? `<button type="button" data-save-detected="${esc(ws.alias || '')}">Save detected tests</button>` : ''}
      </div>
      <pre class="copy-box" data-preflight-out="${esc(ws.alias || '')}" style="display:none;margin-top:10px;max-height:220px;overflow:auto;"></pre>
    </div>`;
}

function fastTaskText(fastTask = {}) {
  const enabled = fastTask.enabled !== false;
  const max = fastTask.maxIndexFiles || 750;
  const includeRoots = Array.isArray(fastTask.includeRoots) && fastTask.includeRoots.length ? ' Include roots: ' + esc(fastTask.includeRoots.join(', ')) + '.' : '';
  return enabled
    ? `Focused context: on. Skips broad indexing for small tasks, caps focused indexes at ${esc(max)} files, and respects .relaiignore/context excludes.${includeRoots}`
    : 'Focused context: off. Context scans may inspect more of the workspace.';
}

function validationText(configured, detected) {
  if (configured.length) return 'Configured tests: ' + esc(configured.join(', '));
  if (detected.length) return 'Auto-detected validation: ' + esc(detected.join(', ')) + '. ChatGPT can run these via relai_run_checks even before saving them.';
  return 'No validation checks found yet. ChatGPT can still run explicit workspace checks.';
}

function findingRow(finding) {
  return `<a class="list-item" href="#settings/diagnostics" style="text-decoration:none;color:inherit;"><span class="dot ${statusClass(finding.severity)}"></span><div><div class="item-title">${esc(finding.code || finding.severity || 'finding')}</div><div class="item-sub">${esc(finding.message || '')}</div></div><div class="item-time">${pillHtml(finding.severity || 'info')}</div></a>`;
}

document.addEventListener('click', async (event) => {
  const addWorkspace = event.target && event.target.closest ? event.target.closest('[data-add-workspace]') : null;
  if (addWorkspace) {
    await addWorkspaceFlow();
    return;
  }

  const renameWorkspace = event.target && event.target.closest ? event.target.closest('[data-rename-workspace]') : null;
  if (renameWorkspace) {
    const alias = renameWorkspace.getAttribute('data-rename-workspace') || '';
    await renameWorkspaceFlow(alias);
    return;
  }

  const toggleFast = event.target && event.target.closest ? event.target.closest('[data-toggle-fast-task]') : null;
  if (toggleFast) {
    const alias = toggleFast.getAttribute('data-toggle-fast-task') || '';
    await toggleFastTaskFlow(alias);
    return;
  }

  const editFast = event.target && event.target.closest ? event.target.closest('[data-edit-fast-task]') : null;
  if (editFast) {
    const alias = editFast.getAttribute('data-edit-fast-task') || '';
    await editFastTaskFlow(alias);
    return;
  }

  const clearWorkspace = event.target && event.target.closest ? event.target.closest('[data-clear-workspace]') : null;
  if (clearWorkspace) {
    const alias = clearWorkspace.getAttribute('data-clear-workspace') || '';
    await clearWorkspaceFlow(alias);
    return;
  }

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

async function addWorkspaceFlow() {
  const alias = (window.prompt('Workspace alias, for example jjclover') || '').trim();
  if (!alias) return;
  const workspacePath = (window.prompt('Absolute workspace path') || '').trim();
  if (!workspacePath) return;
  const result = await postJson('/api/workspaces', {
    action: 'upsert',
    alias,
    path: workspacePath,
    protectedBranches: ['main', 'master'],
    defaultBaseBranch: 'main',
    allowedRemotes: ['origin'],
    confirmDangerous: true
  });
  if (result && result.ok) {
    toast('Workspace added: ' + alias, { variant: 'success' });
    setTimeout(() => location.reload(), 400);
  } else {
    toast('Could not add workspace: ' + ((result && result.error) || 'unknown error'), { variant: 'error' });
  }
}

async function renameWorkspaceFlow(alias) {
  const nextAlias = (window.prompt('New workspace alias', alias) || '').trim();
  if (!nextAlias || nextAlias === alias) return;
  const result = await postJson('/api/workspaces', {
    action: 'rename',
    alias,
    newAlias: nextAlias
  });
  if (result && result.ok) {
    toast('Workspace renamed to ' + nextAlias, { variant: 'success' });
    setTimeout(() => location.reload(), 400);
  } else {
    toast('Could not rename workspace: ' + ((result && result.error) || 'unknown error'), { variant: 'error' });
  }
}


async function toggleFastTaskFlow(alias) {
  const ws = await loadWorkspace(alias);
  if (!ws) return;
  const fastTask = { ...(ws.fastTask || {}), enabled: !(ws.fastTask && ws.fastTask.enabled !== false) };
  const result = await saveWorkspaceFastTask(ws, fastTask);
  if (result && result.ok) {
    toast('Focused context ' + (fastTask.enabled ? 'enabled' : 'disabled') + ' for ' + alias, { variant: 'success' });
    setTimeout(() => location.reload(), 400);
  } else {
    toast('Could not update context mode: ' + ((result && result.error) || 'unknown error'), { variant: 'error' });
  }
}

async function editFastTaskFlow(alias) {
  const ws = await loadWorkspace(alias);
  if (!ws) return;
  const current = ws.fastTask || {};
  const maxIndexFiles = window.prompt('Max files for focused context', String(current.maxIndexFiles || 750));
  if (maxIndexFiles == null) return;
  const includeRoots = window.prompt('Optional include roots, comma-separated. Leave blank to scan all non-excluded source files.', Array.isArray(current.includeRoots) ? current.includeRoots.join(', ') : '');
  if (includeRoots == null) return;
  const excludePaths = window.prompt('Extra exclude paths, comma-separated. .relaiignore is also respected.', Array.isArray(current.excludePaths) ? current.excludePaths.join(', ') : '');
  if (excludePaths == null) return;
  const fastTask = {
    ...current,
    enabled: current.enabled !== false,
    skipIndexForSmallTasks: true,
    preferChangedFiles: true,
    maxIndexFiles: Number(maxIndexFiles) || current.maxIndexFiles || 750,
    includeRoots: splitList(includeRoots),
    excludePaths: splitList(excludePaths)
  };
  const result = await saveWorkspaceFastTask(ws, fastTask);
  if (result && result.ok) {
    toast('Context settings saved for ' + alias, { variant: 'success' });
    setTimeout(() => location.reload(), 400);
  } else {
    toast('Could not save context settings: ' + ((result && result.error) || 'unknown error'), { variant: 'error' });
  }
}

async function clearWorkspaceFlow(alias) {
  const ok = window.confirm(`Clear workspace '${alias}' from Rel.AI? This removes only the dashboard/config entry. It does not clear repo files.`);
  if (!ok) return;
  const result = await postJson('/api/workspaces', { action: 'clear', alias, confirmClear: true });
  if (result && result.ok) {
    toast('Workspace cleared: ' + alias, { variant: 'success' });
    setTimeout(() => location.reload(), 400);
  } else {
    toast('Could not clear workspace: ' + ((result && result.error) || 'unknown error'), { variant: 'error' });
  }
}

async function loadWorkspace(alias) {
  const dashboard = await fetchJson('/api/dashboard/v10?limit=100&requireHttpToken=0');
  const ws = dashboard && dashboard.config && Array.isArray(dashboard.config.workspaces)
    ? dashboard.config.workspaces.find(item => item.alias === alias)
    : null;
  if (!ws) toast('Workspace not found: ' + alias, { variant: 'error' });
  return ws;
}

function saveWorkspaceFastTask(ws, fastTask) {
  return postJson('/api/workspaces', {
    action: 'upsert',
    alias: ws.alias,
    path: ws.path,
    protectedBranches: ws.protectedBranches,
    defaultBaseBranch: ws.defaultBaseBranch,
    allowedRemotes: ws.allowedRemotes,
    fastTask,
    confirmDangerous: true
  });
}

function splitList(value) {
  return String(value || '').split(/[,\n]/).map(item => item.trim()).filter(Boolean);
}
