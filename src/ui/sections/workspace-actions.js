import { fetchJson, postJson, DASHBOARD_DATA_URL, requestDashboardRefresh } from '../api.js';
import { toast } from '../components/toast.js';
import { openWorkspaceForm } from './workspace-form.js';
import { pluralSuffix } from './workspace-cards.js';
import { runButtonAction } from '../action-state.js';

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
  { selector: '[data-run-validation]', handler: runValidationFromTrigger },
  { selector: '[data-open-folder]', handler: openFolderFromTrigger },
  { selector: '[data-save-detected]', handler: saveDetectedFromTrigger }
];

let bound = false;
export function bindWorkspaceActions() {
  if (bound) return;
  bound = true;
  document.addEventListener('click', handleWorkspaceClick);
}

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
  const result = await runButtonAction(preflight, {
    idleText: 'Run preflight',
    loadingText: 'Running preflight…',
    successText: 'Preflight complete',
    errorText: 'Preflight failed'
  }, () => fetchJson('/api/workspace/preflight?workspace=' + encodeURIComponent(alias) + '&requireClean=0'));
  if (out) { out.classList.add('open'); renderPreflight(out, result); }
  if (result?.ok === false) toast('Preflight needs attention: ' + (result.error || 'review the findings below'), { variant: 'warn' });
} 

async function runValidationFromTrigger(trigger) {
  const alias = trigger.dataset.runValidation || '';
  const result = await runButtonAction(trigger, {
    idleText: 'Run validation', loadingText: 'Validating…', successText: 'Validation complete', errorText: 'Validation failed'
  }, () => postJson('/api/workspace/checks', { workspace: alias }, { timeout: 0 }));
  toast(result?.ok === false ? `Validation failed for ${alias}: ${result.error || 'review task details'}` : `Validation completed for ${alias}.`, { variant: result?.ok === false ? 'error' : 'success' });
  requestDashboardRefresh();
}

async function openFolderFromTrigger(trigger) {
  const alias = trigger.dataset.openFolder || '';
  const result = await runButtonAction(trigger, {
    idleText: 'Open folder', loadingText: 'Opening…', successText: 'Folder opened', errorText: 'Open failed'
  }, () => postJson('/api/open-folder', { workspace: alias }));
  if (result?.ok === false) toast(result.error || 'Folder opening is only available in the desktop app.', { variant: 'warn' });
}

async function saveDetectedFromTrigger(saveDetected) {
  const alias = saveDetected.dataset.saveDetected || '';
  const result = await runButtonAction(saveDetected, {
    idleText: 'Save detected tests',
    loadingText: 'Saving tests…',
    successText: 'Tests saved',
    errorText: 'Save failed'
  }, () => saveDetectedTests(alias));
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
