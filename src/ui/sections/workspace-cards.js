import { pillHtml } from '../components/pill.js';
import { esc, metricHtml, statusClass, timeAgo } from '../utils.js';
import { getWorkspaceFilter, routeHref } from '../router.js';

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
  const validationReady = workspaces.filter(workspace => validationCommands(workspace).length > 0).length;

  const root = document.createElement('div');
  root.className = 'section';
  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Workspaces</h2>
        <p>Repositories available to ChatGPT, with their current Git state and automatic validation plan.</p>
      </div>
      <div class="section-head-actions">
        <button type="button" data-add-workspace>Add workspace</button>
        <span class="section-action">${workspaceCountLabel(workspaces.length, allWorkspaces.length, Boolean(workspaceFilter))}</span>
      </div>
    </div>
    <div class="overview-grid overview-grid-compact">
      ${metricHtml('Workspaces', workspaces.length, workspaceFilter ? 'shown by the current filter' : 'configured repositories', 'blue')}
      ${metricHtml('Validation ready', `${validationReady}/${workspaces.length}`, 'automatic standard checks detected', validationReady === workspaces.length && workspaces.length ? 'good' : 'warn')}
      ${metricHtml('Needs attention', findings.length, findings.length ? 'workspace or configuration findings' : 'no blocking findings', findings.length ? 'bad' : 'good')}
    </div>`;

  const grid = document.createElement('div');
  grid.className = 'workspace-grid workspace-grid-detailed';
  grid.innerHTML = workspaces.length
    ? workspaces.map(workspace => workspaceCard(workspace, healthByAlias.get(workspace.alias))).join('')
    : emptyWorkspaceMessage(workspaceFilter);
  root.appendChild(grid);

  if (findings.length) root.appendChild(healthFindingsCard(findings));
  return root;
}

function workspaceCountLabel(shown, total, filtered) {
  if (!filtered) return `${total} configured`;
  return `${shown} shown · ${total} configured`;
}

function emptyWorkspaceMessage(workspaceFilter) {
  if (workspaceFilter) {
    return '<div class="empty">The selected workspace no longer exists or is hidden by the current filter.</div>';
  }
  return '<div class="empty">No workspaces configured. Add a repository to make it available to ChatGPT.</div>';
}

function workspaceCard(workspace, health) {
  const view = workspaceCardView(workspace, health);
  return `
    <article class="workspace-card workspace-card-detailed" data-workspace-card="${view.aliasAttr}">
      <header class="workspace-card-head">
        <div class="workspace-identity">
          <strong>${esc(view.alias)}</strong>
          <div class="workspace-path" title="${esc(view.path)}">${esc(view.path)}</div>
        </div>
        ${pillHtml(view.status)}
      </header>
      ${workspaceHealthHtml(view)}
      ${workspaceOperationalHtml(view)}
      ${workspaceValidationHtml(view)}
      ${workspacePolicyHtml(view)}
      ${workspaceActivityNotice(view)}
      <footer class="workspace-actions">${workspaceActionButtons(view)}</footer>
    </article>`;
}

function workspaceCardView(workspace, health) {
  const operational = workspace.operational || {};
  const commands = validationCommands(workspace);
  return {
    alias: workspace.alias || 'workspace',
    aliasAttr: esc(workspace.alias || ''),
    path: workspace.path || '',
    status: health?.ok === false ? 'error' : 'ready',
    healthWarning: health?.ok === false ? health.error || 'Workspace unavailable' : '',
    operational,
    validationCommands: commands,
    protectedBranches: listValue(workspace.protectedBranches),
    allowedRemotes: listValue(workspace.allowedRemotes),
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

function workspaceHealthHtml(view) {
  if (!view.healthWarning) return '';
  return `<div class="workspace-warning"><span>${esc(view.healthWarning)}</span><button class="secondary" type="button" data-fix-path="${view.aliasAttr}">Fix path</button></div>`;
}

function workspaceOperationalHtml(view) {
  const state = view.operational;
  const branch = branchSummary(state);
  const worktree = state.dirty
    ? `${Number(state.changedFileCount || 0)} changed · ${Number(state.sessionChangedFileCount || 0)} from current session`
    : 'Clean';
  const validation = state.lastValidation
    ? `${state.lastValidation.status} · ${timeAgo(state.lastValidation.completedAt)}`
    : 'Not run yet';
  const activity = state.lastTask
    ? `${state.lastTask.status} · ${timeAgo(state.lastTask.completedAt || state.lastTask.startedAt)}`
    : 'No task history';
  return `<div class="workspace-operational">
    ${operationalItem('Branch', branch)}
    ${operationalItem('Worktree', worktree)}
    ${operationalItem('Last validation', validation)}
    ${operationalItem('Last activity', activity)}
  </div>`;
}

function operationalItem(label, value) {
  return `<div><span>${esc(label)}</span><strong title="${esc(value)}">${esc(value)}</strong></div>`;
}

function branchSummary(operational) {
  if (!operational.branch) return 'Git unavailable';
  if (!operational.ahead && !operational.behind) return operational.branch;
  return `${operational.branch} · ↑${Number(operational.ahead || 0)} ↓${Number(operational.behind || 0)}`;
}

function workspaceValidationHtml(view) {
  const commands = view.validationCommands;
  const ready = commands.length > 0;
  const commandHtml = ready
    ? `<div class="validation-command-list">${commands.map(command => `<code class="validation-command">${esc(command)}</code>`).join('')}</div>`
    : '<p class="workspace-validation-empty">No standard validation commands were detected. Add a check, test, or build script to the repository manifest.</p>';
  const statusPill = ready
    ? pillHtml('ready')
    : '<span class="status-pill warn">not detected<span class="sr-only"> (warning)</span></span>';
  return `<section class="workspace-validation ${ready ? 'ready' : 'missing'}">
    <div class="workspace-validation-head">
      <div>
        <span class="workspace-section-label">Automatic validation</span>
        <strong>${ready ? `${commands.length} command${commands.length === 1 ? '' : 's'} will run` : 'No commands detected'}</strong>
      </div>
      ${statusPill}
    </div>
    ${commandHtml}
  </section>`;
}

function workspacePolicyHtml(view) {
  const branches = view.protectedBranches.length ? view.protectedBranches.join(', ') : 'none';
  const remotes = view.allowedRemotes.length ? view.allowedRemotes.join(', ') : 'none';
  return `<div class="workspace-policy">
    <span><strong>Protected branches:</strong> ${esc(branches)}</span>
    <span><strong>Allowed remotes:</strong> ${esc(remotes)}</span>
  </div>`;
}

function workspaceActivityNotice(view) {
  const items = [];
  if (view.sessionActive) items.push(view.taskHint ? `Active session: ${view.taskHint}` : 'Active editing session');
  if (view.cautionCount > 0) items.push(`${view.cautionCount} protected configuration change${view.cautionCount === 1 ? '' : 's'} recorded`);
  if (!items.length) return '';
  return `<div class="workspace-notice">${items.map(item => `<span>${esc(item)}</span>`).join('')}</div>`;
}

function workspaceActionButtons(view) {
  const openFolder = document.documentElement.dataset.surface === 'desktop'
    ? `<button class="secondary" type="button" data-open-folder="${view.aliasAttr}">Open folder</button>`
    : '';
  return `
    <button type="button" data-edit-workspace="${view.aliasAttr}">Edit workspace</button>
    <button class="secondary" type="button" data-run-validation="${view.aliasAttr}" ${view.validationCommands.length ? '' : 'disabled'}>Run validation</button>
    <a class="buttonlike secondary" href="${routeHref('tasks', { workspace: view.alias })}">Tasks</a>
    <a class="buttonlike secondary" href="${routeHref('activity', { workspace: view.alias })}">Activity</a>
    ${openFolder}
    <button class="secondary danger workspace-remove" type="button" data-clear-workspace="${view.aliasAttr}">Remove workspace</button>`;
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
    return `<div class="list-item finding-row">${inner}<div class="finding-actions"><button class="secondary" type="button" data-finding-edit="${esc(alias)}">Edit path</button><button class="secondary danger" type="button" data-finding-remove="${esc(alias)}">Remove</button></div></div>`;
  }
  return `<a class="list-item finding-link" href="#settings/diagnostics">${inner}<div class="item-time">${pillHtml(finding.severity || 'info')}</div></a>`;
}

function actionableFindings(health, workspaceFilter = '') {
  return (Array.isArray(health.findings) ? health.findings : [])
    .filter(finding => finding.severity !== 'info')
    .filter(finding => !workspaceFilter || !finding.workspace || finding.workspace === workspaceFilter);
}

export { buildWorkspaces };
