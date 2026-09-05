import { pillHtml } from '../../components/pill.js';
import { esc, metricHtml, statusClass } from '../../utils.js';
import { getWorkspaceFilter, routeHref } from '../../router.js';
import { branchSummary } from './details.js';
import { recentWorkspaceAliases } from './recents.js';
import { hydrateWorkspaceAnalytics } from './analytics.js';
import { iconActionHtml } from '../../components/icons.js';

function buildWorkspaces(data, options = {}) {
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

  const root = document.createElement('div');
  root.className = 'section';
  root.innerHTML = `
    <div class="feature-toolbar workspace-toolbar">
      <p>See each project’s status and common actions.</p>
      <div class="section-head-actions">
        ${workspaceFilter ? `<a class="buttonlike secondary compact-button workspace-focus-chip" href="#workspaces" aria-label="Clear selected project filter: ${esc(workspaceFilter)}" title="Show all projects"><span>${esc(workspaceFilter)}</span><span aria-hidden="true">×</span></a>` : ''}
        <span class="feature-count">${allWorkspaces.length} project${allWorkspaces.length === 1 ? '' : 's'}</span>
        <button class="primary" type="button" data-add-workspace>Add project</button>
      </div>
    </div>`;

  const recent = recentWorkspaceAliases(allWorkspaces);
  if (!workspaceFilter && recent.length) root.appendChild(recentWorkspaces(recent));

  if (!workspaces.length) {
    root.appendChild(emptyWorkspaceState());
    return root;
  }

  const metrics = document.createElement('div');
  metrics.className = 'overview-grid overview-grid-compact summary-metrics overview-grid-two';
  metrics.innerHTML = `
    ${metricHtml('Ready for ChatGPT', `${availableCount}/${workspaces.length}`, availableCount === workspaces.length ? 'All project folders are available' : 'One or more project folders need attention', availableCount === workspaces.length ? 'good' : 'warn')}
    ${metricHtml('Needs attention', findings.length, findings.length ? 'Problems that may affect a project' : 'No blocking problems', findings.length ? 'bad' : 'good')}`;
  root.appendChild(metrics);

  const grid = document.createElement('div');
  grid.className = 'workspace-grid workspace-grid-detailed';
  grid.innerHTML = views.map(workspaceCard).join('');
  root.appendChild(grid);
  if (options.hydrateAnalytics !== false) void hydrateWorkspaceAnalytics(grid, views.map(view => view.alias));

  if (findings.length) root.appendChild(healthFindingsCard(findings));
  return root;
}

function recentWorkspaces(aliases) {
  const section = document.createElement('section');
  section.className = 'workspace-recents';
  section.setAttribute('aria-label', 'Recent projects');
  section.innerHTML = `<span>Recent projects</span><div>${aliases.map(alias => `<button class="secondary workspace-recent-chip" type="button" data-open-recent-workspace="${esc(alias)}">${esc(alias)}</button>`).join('')}</div>`;
  return section;
}

function emptyWorkspaceState() {
  const empty = document.createElement('section');
  empty.className = 'workspace-empty-state';
  empty.innerHTML = `
    <div class="workspace-empty-mark" aria-hidden="true">+</div>
    <strong>Add your first project</strong>
    <p>Select a project folder and give it a short name. Rel.AI will find Git and any available checks automatically.</p>
    <button class="primary" type="button" data-add-workspace>Add project</button>`;
  return empty;
}

function workspaceCard(view) {
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
      <section class="workspace-analytics-mini" data-workspace-analytics="${view.aliasAttr}" aria-label="${view.aliasAttr} analytics" hidden></section>
      <footer class="workspace-actions workspace-primary-actions">${workspacePrimaryActions(view)}</footer>
    </article>`;
}

function workspaceCardView(workspace, health) {
  const operational = workspace.operational || {};
  const healthWarning = health?.ok === false ? health.error || 'Project unavailable' : '';
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
    sessionActive: workspace.sessionPolicy?.sessionActive === true,
    taskHint: workspace.sessionPolicy?.taskHint || '',
    cautionCount: Number.isFinite(workspace.caution?.count) ? workspace.caution.count : 0
  };
}

function workspaceStatusPill(view) {
  return pillHtml(view.statusLabel);
}

function workspaceHealthHtml(view) {
  if (!view.healthWarning) return '';
  return `<div class="workspace-warning"><span>${esc(view.healthWarning)}</span><button class="secondary" type="button" data-repair-workspace="${view.aliasAttr}">Fix folder</button></div>`;
}

function workspaceReadinessHtml(view) {
  const repository = repositorySummary(view.operational);
  if (view.available) {
    return `<section class="workspace-readiness compact good" aria-label="Project status">
      <dl class="workspace-readiness-facts">
        ${readinessFact('Git', repository.label, repository.description, repository.tone)}
      </dl>
    </section>`;
  }
  return `<section class="workspace-readiness bad" aria-label="Project status">
    <div class="workspace-access-summary">
      <span class="workspace-readiness-icon" aria-hidden="true">!</span>
      <div class="workspace-readiness-copy">
        <span class="workspace-readiness-kicker">Project access</span>
        <strong>Project folder unavailable</strong>
        <p>Fix the project folder before using this project.</p>
      </div>
    </div>
    <dl class="workspace-readiness-facts">
      ${readinessFact('Git', repository.label, repository.description, repository.tone)}
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
  if (operational.exists === false) return { label: 'Folder missing', description: 'Rel.AI cannot find this project folder.', tone: 'bad' };
  if (!operational.isGit) return { label: 'Git not set up', description: 'You can still work with files, but Git actions are unavailable.', tone: 'neutral' };
  const branch = branchSummary(operational);
  const changes = operational.dirty ? `${Number(operational.changedFileCount || 0)} changed file${Number(operational.changedFileCount || 0) === 1 ? '' : 's'}` : 'No uncommitted changes';
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
    ? `<button class="secondary" type="button" data-open-folder="${view.aliasAttr}">${iconActionHtml('folder', 'Project folder')}</button>`
    : '';
  return `
    ${openFolder}
    <button type="button" data-edit-workspace="${view.aliasAttr}">Edit project</button>
    <a class="buttonlike secondary" href="${routeHref('usage', { workspace: view.alias })}">Analytics</a>`;
}

function healthFindingsCard(findings) {
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = '<div class="card-head"><h3>Needs attention</h3><a class="section-action" href="#diagnostics">Troubleshoot</a></div>';
  const body = document.createElement('div');
  body.className = 'card-body list';
  body.innerHTML = findings.map(findingRow).join('');
  card.appendChild(body);
  return card;
}

function findingRow(finding) {
  const alias = finding.workspace || '';
  const actionable = finding.code === 'workspace_unavailable' && alias;
  const title = finding.message || humanizeFindingCode(finding.code) || 'Project needs attention';
  const context = alias ? `Project: ${alias}` : 'Open Troubleshooting for details.';
  const inner = `<span class="dot ${statusClass(finding.severity)}"></span><div class="finding-main"><div class="item-title">${esc(title)}</div><div class="item-sub">${esc(context)}</div></div>`;
  if (actionable) {
    return `<div class="list-item finding-row">${inner}<div class="finding-actions"><button class="secondary" type="button" data-finding-repair="${esc(alias)}">Fix folder</button><button class="secondary danger" type="button" data-finding-remove="${esc(alias)}">Remove</button></div></div>`;
  }
  return `<a class="list-item finding-link" href="#diagnostics">${inner}<div class="item-time">${pillHtml(findingSeverityLabel(finding.severity), statusClass(finding.severity))}</div></a>`;
}

function findingSeverityLabel(severity) {
  if (severity === 'error') return 'Blocking';
  if (severity === 'warning') return 'Warning';
  return 'Recommendation';
}

function humanizeFindingCode(code) {
  const text = String(code || '').trim().replaceAll('_', ' ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function actionableFindings(health) {
  return (Array.isArray(health.findings) ? health.findings : [])
    .filter(finding => finding.severity !== 'info');
}

export { buildWorkspaces };
