// Workspaces section — configured repositories and validation setup
import { fetchJson, postJson, DASHBOARD_DATA_URL, requestDashboardRefresh } from '../api.js';
import { pillHtml } from '../components/pill.js';
import { badgeHtml } from '../components/badge.js';
import { toast } from '../components/toast.js';
import { esc, metricHtml, statusClass } from '../utils.js';
import { openWorkspaceForm } from './workspace-form.js';

export function mountWorkspaces(container, data) {
  container.innerHTML = '';
  container.appendChild(buildWorkspaces(data || {}));
}

function buildWorkspaces(data) {
  const cfg = data.config || {};
  const health = data.health || {};
  const workspaces = Array.isArray(cfg.workspaces) ? cfg.workspaces : [];
  const toolCount = Number.isFinite(Number(data.toolCount)) && Number(data.toolCount) > 0 ? Number(data.toolCount) : 24;
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
      ${metricHtml('ChatGPT tools', toolCount, 'workspace tools', 'good')}
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

function listValue(value) {
  return Array.isArray(value) ? value : [];
}

function isFocusedContext(ws) {
  return ws.fastTask?.enabled !== false;
}

function workspaceCardView(ws, health) {
  const testKeys = listValue(ws.testCommandKeys);
  const detected = listValue(ws.discoveredTestCommandKeys);
  return {
    alias: ws.alias || 'workspace',
    aliasAttr: esc(ws.alias || ''),
    path: ws.path || '',
    status: health?.ok === false ? 'check' : 'healthy',
    testKeys,
    commandKeys: listValue(ws.commandKeys),
    detected,
    staleKeys: listValue(ws.staleTestCommandKeys),
    protectedBranches: listValue(ws.protectedBranches),
    sessionActive: ws.sessionPolicy?.sessionActive === true,
    taskHint: ws.sessionPolicy?.taskHint || '',
    cautionCount: Number.isFinite(ws.caution?.count) ? ws.caution.count : 0,
    focused: isFocusedContext(ws),
    healthWarning: health?.ok === false ? health.error || 'Workspace unavailable' : ''
  };
}

function workspaceHealthHtml(view) {
  if (!view.healthWarning) return '';
  return `<div style="margin-top:8px;padding:8px 10px;border:1px solid var(--red);border-radius:8px;background:rgba(255,111,136,.10);font-size:12px;color:var(--text);display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;"><span>⚠ ${esc(view.healthWarning)}</span><button class="secondary" type="button" data-fix-path="${view.aliasAttr}">Fix path</button></div>`;
}

function workspaceBadgeRow(view) {
  return [
    badgeHtml('configured tests ' + view.testKeys.length),
    view.staleKeys.length ? badgeHtml('stale tests ' + view.staleKeys.length, 'warn') : '',
    badgeHtml('detected tests ' + view.detected.length, view.detected.length ? 'good' : 'warn'),
    badgeHtml('commands ' + view.commandKeys.length),
    badgeHtml('context mode ' + (view.focused ? 'focused' : 'broad'), view.focused ? 'good' : 'warn'),
    badgeHtml('protected ' + (view.protectedBranches.join(', ') || 'none')),
    view.sessionActive ? badgeHtml('session active', 'good') : '',
    view.cautionCount > 0 ? badgeHtml('caution ' + view.cautionCount, 'warn') : ''
  ].join('');
}

function workspaceExtraLines(view, ws) {
  const stale = view.staleKeys.length ? `<div class="path" style="color:var(--yellow,#ffc24b);">Stale tests (no longer in package scripts): ${esc(view.staleKeys.join(', '))}</div>` : '';
  const task = view.sessionActive && view.taskHint ? `<div class="path">Task: ${esc(view.taskHint)}</div>` : '';
  return `${stale}<div class="path">${fastTaskText(ws.fastTask)}</div>${task}`;
}

function pluralSuffix(count) {
  return count === 1 ? '' : 's';
}

function saveDetectedButton(view) {
  if (!view.detected.length || view.testKeys.length) return '';
  return `<button type="button" data-save-detected="${view.aliasAttr}">Save detected tests</button>`;
}

function pruneStaleButton(view) {
  if (!view.staleKeys.length) return '';
  return `<button class="secondary danger" type="button" data-prune-stale="${view.aliasAttr}">Remove ${esc(view.staleKeys.length)} stale test${pluralSuffix(view.staleKeys.length)}</button>`;
}

function workspaceActionButtons(view) {
  const saveDetected = saveDetectedButton(view);
  const prune = pruneStaleButton(view);
  return `
    <button class="secondary" type="button" data-preflight="${view.aliasAttr}">Run preflight</button>
    <button class="secondary" type="button" data-toggle-fast-task="${view.aliasAttr}">${view.focused ? 'Use broad context' : 'Use focused context'}</button>
    <button class="secondary" type="button" data-edit-fast-task="${view.aliasAttr}">Context settings</button>
    <button class="secondary" type="button" data-edit-workspace="${view.aliasAttr}">Edit</button>
    <button class="secondary" type="button" data-rename-workspace="${view.aliasAttr}">Rename</button>
    <button class="secondary danger" type="button" data-clear-workspace="${view.aliasAttr}">Clear</button>
    ${saveDetected}${prune}`;
}

function workspaceCard(ws, health) {
  const view = workspaceCardView(ws, health);
  return `
    <div class="workspace-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <strong>${esc(view.alias)}</strong>
        ${pillHtml(view.status)}
      </div>
      <div class="path">${esc(view.path)}</div>
      ${workspaceHealthHtml(view)}
      <div class="badge-row">${workspaceBadgeRow(view)}</div>
      <div class="path">${validationText(view.testKeys, view.detected)}</div>
      ${workspaceExtraLines(view, ws)}
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">${workspaceActionButtons(view)}</div>
      <pre class="copy-box" data-preflight-out="${view.aliasAttr}" style="display:none;margin-top:10px;max-height:220px;overflow:auto;"></pre>
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
  const alias = finding.workspace || '';
  const actionable = finding.code === 'workspace_unavailable' && alias;
  const inner = `<span class="dot ${statusClass(finding.severity)}"></span><div style="flex:1;"><div class="item-title">${esc(finding.code || finding.severity || 'finding')}</div><div class="item-sub">${esc(finding.message || '')}</div></div>`;
  if (actionable) {
    return `<div class="list-item" style="display:flex;align-items:center;gap:10px;">${inner}<div style="display:flex;gap:6px;flex-shrink:0;"><button class="secondary" type="button" data-finding-edit="${esc(alias)}">Edit path</button><button class="secondary danger" type="button" data-finding-remove="${esc(alias)}">Remove</button></div></div>`;
  }
  return `<a class="list-item" href="#settings/diagnostics" style="text-decoration:none;color:inherit;">${inner}<div class="item-time">${pillHtml(finding.severity || 'info')}</div></a>`;
}

const WORKSPACE_CLICK_ACTIONS = [
  { selector: '[data-add-workspace]', handler: () => openWorkspaceForm({ mode: 'add' }) },
  { selector: '[data-edit-workspace],[data-fix-path],[data-finding-edit]', handler: editWorkspaceFromTrigger },
  { selector: '[data-finding-remove]', handler: (trigger) => clearWorkspaceFlow(trigger.dataset.findingRemove || '') },
  { selector: '[data-rename-workspace]', handler: (trigger) => renameWorkspaceFlow(trigger.dataset.renameWorkspace || '') },
  { selector: '[data-toggle-fast-task]', handler: (trigger) => toggleFastTaskFlow(trigger.dataset.toggleFastTask || '') },
  { selector: '[data-edit-fast-task]', handler: (trigger) => editFastTaskFlow(trigger.dataset.editFastTask || '') },
  { selector: '[data-clear-workspace]', handler: (trigger) => clearWorkspaceFlow(trigger.dataset.clearWorkspace || '') },
  { selector: '[data-prune-stale]', handler: (trigger) => pruneStaleTestsFlow(trigger.dataset.pruneStale || '') },
  { selector: '[data-preflight]', handler: runPreflightFromTrigger },
  { selector: '[data-save-detected]', handler: saveDetectedFromTrigger }
];

document.addEventListener('click', handleWorkspaceClick);

async function handleWorkspaceClick(event) {
  for (const action of WORKSPACE_CLICK_ACTIONS) {
    const trigger = event.target?.closest?.(action.selector) ?? null;
    if (!trigger) continue;
    await action.handler(trigger);
    return;
  }
}

async function editWorkspaceFromTrigger(trigger) {
  const alias = trigger.dataset.editWorkspace || trigger.dataset.fixPath || trigger.dataset.findingEdit || '';
  const ws = await loadWorkspace(alias);
  if (ws) openWorkspaceForm({ mode: 'edit', workspace: ws });
}

async function runPreflightFromTrigger(preflight) {
  const alias = preflight.dataset.preflight || '';
  const out = preflightOutput(alias);
  preflight.disabled = true;
  preflight.textContent = 'Running…';
  const result = await fetchJson('/api/workspace/preflight?workspace=' + encodeURIComponent(alias) + '&requireClean=0');
  if (out) { out.style.display = 'block'; renderPreflight(out, result); }
  preflight.disabled = false;
  preflight.textContent = 'Run preflight';
}

async function saveDetectedFromTrigger(saveDetected) {
  const alias = saveDetected.dataset.saveDetected || '';
  saveDetected.disabled = true;
  saveDetected.textContent = 'Saving…';
  const result = await saveDetectedTests(alias);
  saveDetected.disabled = false;
  saveDetected.textContent = 'Save detected tests';
  if (result?.ok) {
    toast('Detected tests saved for ' + alias + '.', { variant: 'success' });
    requestDashboardRefresh();
  } else {
    toast('Could not save detected tests: ' + (result?.error || 'unknown error'), { variant: 'error' });
  }
}

async function saveDetectedTests(alias) {
  const dashboard = await fetchJson(DASHBOARD_DATA_URL);
  const ws = Array.isArray(dashboard?.config?.workspaces)
    ? dashboard.config.workspaces.find(item => item.alias === alias)
    : null;
  if (!ws) return { ok: false, error: 'workspace not found' };
  const discovered = objectOrEmpty(ws.discoveredCommands);
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

function renderPreflight(out, result) {
  if (!result || typeof result !== 'object') { out.textContent = String(result); return; }
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const parts = [result.ok === true ? '✓ Preflight passed' : '✗ Preflight found issues'];
  if (result.branch) parts.push('branch: ' + result.branch);
  if (result.error) parts.push(result.error);
  for (const f of findings) parts.push((f.severity === 'error' ? '✗ ' : '⚠ ') + (f.message || f.code || ''));
  if (result.ok === true && !findings.length) parts.push('Workspace is reachable and ready for checks.');
  out.textContent = parts.join('\n');
}

function preflightOutput(alias) {
  return Array.from(document.querySelectorAll('[data-preflight-out]')).find(el => el.dataset.preflightOut === alias) || null;
}

function actionableFindings(health) {
  return Array.isArray(health.findings) ? health.findings.filter(f => f.severity !== 'info') : [];
}

async function renameWorkspaceFlow(alias) {
  const nextAlias = (window.prompt('New workspace alias', alias) || '').trim();
  if (!nextAlias || nextAlias === alias) return;
  const result = await postJson('/api/workspaces', {
    action: 'rename',
    alias,
    newAlias: nextAlias
  });
  if (result?.ok) {
    toast('Workspace renamed to ' + nextAlias, { variant: 'success' });
    requestDashboardRefresh();
  } else {
    toast('Could not rename workspace: ' + (result?.error || 'unknown error'), { variant: 'error' });
  }
}


async function toggleFastTaskFlow(alias) {
  const ws = await loadWorkspace(alias);
  if (!ws) return;
  const fastTask = { ...objectOrEmpty(ws.fastTask), enabled: ws.fastTask?.enabled === false };
  const result = await saveWorkspaceFastTask(ws, fastTask);
  if (result?.ok) {
    toast('Focused context ' + (fastTask.enabled ? 'enabled' : 'disabled') + ' for ' + alias, { variant: 'success' });
    requestDashboardRefresh();
  } else {
    toast('Could not update context mode: ' + (result?.error || 'unknown error'), { variant: 'error' });
  }
}

async function editFastTaskFlow(alias) {
  const ws = await loadWorkspace(alias);
  if (!ws) return;
  const current = objectOrEmpty(ws.fastTask);
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
  if (result?.ok) {
    toast('Context settings saved for ' + alias, { variant: 'success' });
    requestDashboardRefresh();
  } else {
    toast('Could not save context settings: ' + (result?.error || 'unknown error'), { variant: 'error' });
  }
}

async function pruneStaleTestsFlow(alias) {
  const ok = window.confirm(`Remove stale test commands from '${alias}'? This deletes only saved test-command entries that no longer match the workspace package scripts. It does not touch repo files.`);
  if (!ok) return;
  const result = await postJson('/api/workspaces', { action: 'prune-stale-tests', alias });
  if (result?.ok) {
    const removed = Array.isArray(result.removed) ? result.removed.length : 0;
    toast(pruneStaleMessage(removed, alias), { variant: 'success' });
    requestDashboardRefresh();
  } else {
    toast('Could not remove stale tests: ' + (result?.error || 'unknown error'), { variant: 'error' });
  }
}

function pruneStaleMessage(removed, alias) {
  if (!removed) return `No stale test commands for ${alias}.`;
  return `Removed ${removed} stale test command${pluralSuffix(removed)} from ${alias}. Refreshing…`;
}

async function clearWorkspaceFlow(alias) {
  const ok = window.confirm(`Clear workspace '${alias}' from Rel.AI? This removes only the dashboard/config entry. It does not clear repo files.`);
  if (!ok) return;
  const result = await postJson('/api/workspaces', { action: 'clear', alias, confirmClear: true });
  if (result?.ok) {
    toast('Workspace cleared: ' + alias, { variant: 'success' });
    requestDashboardRefresh();
  } else {
    toast('Could not clear workspace: ' + (result?.error || 'unknown error'), { variant: 'error' });
  }
}

async function loadWorkspace(alias) {
  const dashboard = await fetchJson(DASHBOARD_DATA_URL);
  const ws = Array.isArray(dashboard?.config?.workspaces)
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

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function splitList(value) {
  return String(value || '').split(/[,\n]/).map(item => item.trim()).filter(Boolean);
}
