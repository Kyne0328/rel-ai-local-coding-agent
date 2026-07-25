import { pillHtml } from '../components/pill.js';
import { esc, metricHtml, statusClass } from '../utils.js';
import { getWorkspaceFilter } from '../router.js';
import { workspaceDetailsHtml, branchSummary } from './workspace-card-details.js';
import { recentWorkspaceAliases } from '../workspace-recents.js';

function buildWorkspaces(data) {
  const config = data.config || {};
  const health = data.health || {};
  const workspaceFilter = getWorkspaceFilter();
  const allWorkspaces = Array.isArray(config.workspaces) ? config.workspaces : [];
  const workspaces = workspaceFilter
    ? allWorkspaces.filter(workspace => workspace.alias === workspaceFilter)
    : allWorkspaces;
  const healthByAlias = new Map((Array.isArray(health.workspaces) ? health.workspaces : []).map(item => [item.alias, item]));
  const findings = actionableFindings(health, workspaceFilter);
  const views = workspaces.map(workspace => workspaceCardView(workspace, healthByAlias.get(workspace.alias)));
  const availableCount = views.filter(view => view.available).length;
  const validationReady = views.filter(view => view.validationCommands.length > 0).length;
  const showAutomaticValidation = config.productUx?.showAutomaticValidation !== false;

  const root = document.createElement('div');
  root.className = 'section';
  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Workspaces</h2>
        <p>Choose the local repositories ChatGPT can use. Common status and actions stay visible; Git and safety settings remain under details.</p>
      </div>
      <div class="section-head-actions">
        <button class="primary" type="button" data-add-workspace>Add workspace</button>
        <span class="section-action">${workspaceCountLabel(workspaces.length, allWorkspaces.length, Boolean(workspaceFilter))}</span>
      </div>
    </div>`;

  const recent = recentWorkspaceAliases(allWorkspaces);
  if (!workspaceFilter && recent.length) root.appendChild(recentWorkspaces(recent));

  if (!workspaces.length) {
    root.appendChild(emptyWorkspaceState(workspaceFilter));
    return root;
  }

  const metrics = document.createElement('div');
  metrics.className = `overview-grid overview-grid-compact summary-metrics${showAutomaticValidation ? '' : ' overview-grid-two'}`;
  metrics.innerHTML = `
    ${metricHtml('Available to ChatGPT', `${availableCount}/${workspaces.length}`, availableCount === workspaces.length ? 'all selected folders are available' : 'one or more paths need attention', availableCount === workspaces.length ? 'good' : 'warn')}
    ${showAutomaticValidation ? metricHtml('Validation ready', `${validationReady}/${workspaces.length}`, validationReady ? 'automatic checks detected' : 'no automatic checks detected', validationReady === workspaces.length ? 'good' : 'warn') : ''}
    ${metricHtml('Needs attention', findings.length, findings.length ? 'workspace or configuration findings' : 'no blocking findings', findings.length ? 'bad' : 'good')}`;
  root.appendChild(metrics);

  const grid = document.createElement('div');
  grid.className = 'workspace-grid workspace-grid-detailed';
  grid.innerHTML = views.map(view => workspaceCard(view, showAutomaticValidation)).join('');
  root.appendChild(grid);

  if (findings.length) root.appendChild(healthFindingsCard(findings));
  return root;
}

function workspaceCountLabel(shown, total, filtered) {
  if (!filtered) return `${total} configured`;
  return `${shown} shown · ${total} configured`;
}

function recentWorkspaces(aliases) {
  const section = document.createElement('section');
  section.className = 'workspace-recents';
  section.setAttribute('aria-label', 'Recent workspaces');
  section.innerHTML = `<span>Recent workspaces</span><div>${aliases.map(alias => `<button class="secondary workspace-recent-chip" type="button" data-open-recent-workspace="${esc(alias)}">${esc(alias)}</button>`).join('')}</div>`;
  return section;
}

function emptyWorkspaceState(workspaceFilter) {
  const empty = document.createElement('section');
  empty.className = 'workspace-empty-state';
  if (workspaceFilter) {
    empty.innerHTML = '<strong>Workspace not found</strong><p>The selected workspace no longer exists or is hidden by the current filter.</p><a class="buttonlike secondary" href="#workspaces">Show all workspaces</a>';
    return empty;
  }
  empty.innerHTML = `
    <div class="workspace-empty-mark" aria-hidden="true">+</div>
    <strong>Add your first workspace</strong>
    <p>Select a project folder and give it a short name. Rel.AI will detect its repository and validation setup automatically.</p>
    <button class="primary" type="button" data-add-workspace>Add workspace</button>`;
  return empty;
}

function workspaceCard(view, showAutomaticValidation) {
  return `
    <article class="workspace-card workspace-card-detailed" data-workspace-card="${view.aliasAttr}">
      <header class="workspace-card-head">
        <div class="workspace-identity">
          <strong>${esc(view.alias)}</strong>
          <div class="workspace-path" title="${esc(view.path)}">${esc(view.path)}</div>
        </div>
        ${workspaceStatusPill(view)}
      </header>
      ${workspaceHealthHtml(view)}
      ${workspaceReadinessHtml(view)}
      ${workspaceActivityNotice(view)}
      <footer class="workspace-actions workspace-primary-actions">${workspacePrimaryActions(view)}</footer>
      ${workspaceDetailsHtml(view, showAutomaticValidation)}
    </article>`;
}

function workspaceCardView(workspace, health) {
  const operational = workspace.operational || {};
  const commands = validationCommands(workspace);
  const healthWarning = health?.ok === false ? health.error || 'Workspace unavailable' : '';
  const available = !healthWarning && operational.exists !== false;
  const active = Boolean(operational.currentActivity || workspace.sessionPolicy?.sessionActive);
  return {
    alias: workspace.alias || 'workspace',
    aliasAttr: esc(workspace.alias || ''),
    path: workspace.path || '',
    statusLabel: healthWarning ? 'Needs attention' : active ? 'Active' : 'Ready',
    statusTone: healthWarning ? 'bad' : active ? 'warn' : 'ok',
    healthWarning,
    available,
    operational,
    validationCommands: commands,
    projectInstructions: listValue(workspace.projectInstructions?.sources),
    protectedBranches: listValue(workspace.protectedBranches),
    allowedRemotes: listValue(workspace.allowedRemotes),
    defaultBaseBranch: workspace.defaultBaseBranch || 'main',
    sessionActive: workspace.sessionPolicy?.sessionActive === true,
    taskHint: workspace.sessionPolicy?.taskHint || '',
    cautionCount: Number.isFinite(workspace.caution?.count) ? workspace.caution.count : 0
  };
}

function validationCommands(workspace) {
  return listValue(workspace.validationCommands).map(String).filter(Boolean);
}

function listValue(value) {
  return Array.isArray(value) ? value : [];
}

function workspaceStatusPill(view) {
  return `<span class="status-pill ${view.statusTone}">${esc(view.statusLabel)}<span class="sr-only"> (${view.statusTone})</span></span>`;
}

function workspaceHealthHtml(view) {
  if (!view.healthWarning) return '';
  return `<div class="workspace-warning"><span>${esc(view.healthWarning)}</span><button class="secondary" type="button" data-repair-workspace="${view.aliasAttr}">Repair path</button></div>`;
}

function workspaceReadinessHtml(view) {
  const repository = repositorySummary(view.operational);
  const validation = view.validationCommands.length
    ? `${view.validationCommands.length} automatic check${view.validationCommands.length === 1 ? '' : 's'}`
    : 'Not configured';
  return `<div class="workspace-readiness" aria-label="Workspace readiness">
    ${readinessItem('ChatGPT access', view.available ? 'Available' : 'Unavailable', view.available ? 'This folder can be used by Rel.AI tools.' : 'Fix the workspace path before using it.', view.available ? 'good' : 'bad')}
    ${readinessItem('Repository', repository.label, repository.description, repository.tone)}
    ${readinessItem('Validation', validation, view.validationCommands.length ? 'Checks can be run before reviewing changes.' : 'Rel.AI can still work, but no automatic check was detected.', view.validationCommands.length ? 'good' : 'warn')}
  </div>`;
}

function readinessItem(label, value, description, tone) {
  return `<div class="workspace-readiness-item ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(description)}</small></div>`;
}

function repositorySummary(operational) {
  if (operational.exists === false) return { label: 'Path unavailable', description: 'The configured folder cannot be found.', tone: 'bad' };
  if (!operational.isGit) return { label: 'Folder only', description: 'No Git repository was detected at this path.', tone: 'warn' };
  const branch = branchSummary(operational);
  const changes = operational.dirty ? `${Number(operational.changedFileCount || 0)} changed file${Number(operational.changedFileCount || 0) === 1 ? '' : 's'}` : 'Clean worktree';
  return { label: branch, description: changes, tone: operational.dirty ? 'warn' : 'good' };
}

function workspaceActivityNotice(view) {
  const items = [];
  if (view.sessionActive) items.push(view.taskHint ? `Active session: ${view.taskHint}` : 'Active editing session');
  if (view.cautionCount > 0) items.push(`${view.cautionCount} protected configuration change${view.cautionCount === 1 ? '' : 's'} recorded`);
  if (!items.length) return '';
  return `<div class="workspace-notice">${items.map(item => `<span>${esc(item)}</span>`).join('')}</div>`;
}

function workspacePrimaryActions(view) {
  const openFolder = document.documentElement.dataset.surface === 'desktop'
    ? `<button class="secondary" type="button" data-open-folder="${view.aliasAttr}">Open folder</button>`
    : '';
  return `
    <button type="button" data-edit-workspace="${view.aliasAttr}">Workspace settings</button>
    <button class="secondary" type="button" data-run-validation="${view.aliasAttr}" ${view.validationCommands.length ? '' : 'disabled'}>Run validation</button>
    ${openFolder}`;
}

function healthFindingsCard(findings) {
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = '<div class="card-head"><h3>Needs attention</h3><a class="section-action" href="#settings/diagnostics">Open diagnostics</a></div>';
  const body = document.createElement('div');
  body.className = 'card-body list';
  body.innerHTML = findings.map(findingRow).join('');
  card.appendChild(body);
  return card;
}

function findingRow(finding) {
  const alias = finding.workspace || '';
  const actionable = finding.code === 'workspace_unavailable' && alias;
  const inner = `<span class="dot ${statusClass(finding.severity)}"></span><div class="finding-main"><div class="item-title">${esc(finding.code || finding.severity || 'finding')}</div><div class="item-sub">${esc(finding.message || '')}</div></div>`;
  if (actionable) {
    return `<div class="list-item finding-row">${inner}<div class="finding-actions"><button class="secondary" type="button" data-finding-repair="${esc(alias)}">Repair path</button><button class="secondary danger" type="button" data-finding-remove="${esc(alias)}">Remove</button></div></div>`;
  }
  return `<a class="list-item finding-link" href="#settings/diagnostics">${inner}<div class="item-time">${pillHtml(finding.severity || 'info')}</div></a>`;
}

function actionableFindings(health, workspaceFilter = '') {
  return (Array.isArray(health.findings) ? health.findings : [])
    .filter(finding => finding.severity !== 'info')
    .filter(finding => !workspaceFilter || !finding.workspace || finding.workspace === workspaceFilter);
}

export { buildWorkspaces };
