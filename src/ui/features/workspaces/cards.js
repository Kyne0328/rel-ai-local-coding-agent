import { pillHtml } from '../../components/pill.js';
import { esc, metricHtml, statusClass } from '../../utils.js';
import { getWorkspaceFilter } from '../../router.js';
import { workspaceDetailsHtml, branchSummary } from './details.js';
import { recentWorkspaceAliases } from './recents.js';

function buildWorkspaces(data) {
  const config = data.config || {};
  const health = data.health || {};
  const workspaceFilter = getWorkspaceFilter();
  const allWorkspaces = Array.isArray(config.workspaces) ? config.workspaces : [];
  const selectedWorkspace = workspaceFilter
    ? allWorkspaces.find(workspace => workspace.alias === workspaceFilter)
    : null;
  const workspaces = selectedWorkspace
    ? [selectedWorkspace, ...allWorkspaces.filter(workspace => workspace !== selectedWorkspace)]
    : allWorkspaces;
  const healthByAlias = new Map((Array.isArray(health.workspaces) ? health.workspaces : []).map(item => [item.alias, item]));
  const findings = actionableFindings(health);
  const views = workspaces.map(workspace => workspaceCardView(workspace, healthByAlias.get(workspace.alias)));
  const availableCount = views.filter(view => view.available).length;
  const validationReady = views.filter(view => view.validationCommands.length > 0).length;
  const showAutomaticValidation = config.productUx?.showAutomaticValidation !== false;

  const root = document.createElement('div');
  root.className = 'section';
  root.innerHTML = `
    <div class="feature-toolbar workspace-toolbar">
      <p>Common status and actions stay visible. Git, policy, and safety details remain available when needed.</p>
      <div class="section-head-actions">
        ${workspaceFilter ? `<span class="workspace-focus-label" title="Focused workspace: ${esc(workspaceFilter)}">Focused: ${esc(workspaceFilter)}</span><a class="buttonlike secondary compact-button" href="#workspaces">Clear focus</a>` : ''}
        <span class="feature-count">${allWorkspaces.length} configured</span>
        <button class="primary" type="button" data-add-workspace>Add workspace</button>
      </div>
    </div>`;

  const recent = recentWorkspaceAliases(allWorkspaces);
  if (!workspaceFilter && recent.length) root.appendChild(recentWorkspaces(recent));

  if (!workspaces.length) {
    root.appendChild(emptyWorkspaceState());
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

function recentWorkspaces(aliases) {
  const section = document.createElement('section');
  section.className = 'workspace-recents';
  section.setAttribute('aria-label', 'Recent workspaces');
  section.innerHTML = `<span>Recent workspaces</span><div>${aliases.map(alias => `<button class="secondary workspace-recent-chip" type="button" data-open-recent-workspace="${esc(alias)}">${esc(alias)}</button>`).join('')}</div>`;
  return section;
}

function emptyWorkspaceState() {
  const empty = document.createElement('section');
  empty.className = 'workspace-empty-state';
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
  return pillHtml(view.statusLabel);
}

function workspaceHealthHtml(view) {
  if (!view.healthWarning) return '';
  return `<div class="workspace-warning"><span>${esc(view.healthWarning)}</span><button class="secondary" type="button" data-repair-workspace="${view.aliasAttr}">Repair path</button></div>`;
}

function workspaceReadinessHtml(view) {
  const repository = repositorySummary(view.operational);
  const validationReady = view.validationCommands.length > 0;
  const validationValue = validationReady
    ? `${view.validationCommands.length} automatic check${view.validationCommands.length === 1 ? '' : 's'}`
    : 'Add when ready';
  const accessTitle = view.available ? 'Ready for ChatGPT' : 'Project folder unavailable';
  const accessDescription = view.available
    ? 'Rel.AI can inspect and update this workspace when you approve a tool call.'
    : 'Repair the configured folder before using this workspace.';
  return `<section class="workspace-readiness ${view.available ? 'good' : 'bad'}" aria-label="Workspace readiness">
    <div class="workspace-access-summary">
      <span class="workspace-readiness-icon" aria-hidden="true">${view.available ? '✓' : '!'}</span>
      <div class="workspace-readiness-copy">
        <span class="workspace-readiness-kicker">Workspace access</span>
        <strong>${esc(accessTitle)}</strong>
        <p>${esc(accessDescription)}</p>
      </div>
    </div>
    <dl class="workspace-readiness-facts">
      ${readinessFact('Repository', repository.label, repository.description, repository.tone)}
      ${readinessFact('Validation', validationValue, validationReady ? 'Run checks before reviewing changes.' : 'No automatic check is configured.', validationReady ? 'good' : 'warn')}
    </dl>
  </section>`;
}

function readinessFact(label, value, description, tone) {
  return `<div class="workspace-readiness-fact ${tone}">
    <dt><i aria-hidden="true"></i>${esc(label)}</dt>
    <dd><strong>${esc(value)}</strong><small>${esc(description)}</small></dd>
  </div>`;
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
    <button type="button" data-edit-workspace="${view.aliasAttr}">Edit workspace</button>
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

function actionableFindings(health) {
  return (Array.isArray(health.findings) ? health.findings : [])
    .filter(finding => finding.severity !== 'info');
}

export { buildWorkspaces };
