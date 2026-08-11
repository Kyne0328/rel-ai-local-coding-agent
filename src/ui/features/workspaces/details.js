import { pillHtml } from '../../components/pill.js';
import { esc, timeAgo } from '../../utils.js';
import { routeHref } from '../../router.js';
import { workSessionStateView } from '../../task-identity.js';

function workspaceDetailsHtml(view, showAutomaticValidation) {
  return `<div class="workspace-details" hidden>
    <div class="workspace-details-body">
      ${workspaceOperationalHtml(view)}
      ${showAutomaticValidation ? workspaceValidationHtml(view) : ''}
      ${workspacePolicyHtml(view)}
      <div class="workspace-secondary-actions">
        <a class="buttonlike secondary" href="${routeHref('tasks', { workspace: view.alias })}">View sessions</a>
        <a class="buttonlike secondary" href="${routeHref('activity', { workspace: view.alias })}">View activity</a>
        <button class="secondary danger workspace-remove" type="button" data-clear-workspace="${view.aliasAttr}">Remove workspace</button>
      </div>
    </div>
  </div>`;
}

function workspaceOperationalHtml(view) {
  const state = view.operational;
  const worktree = state.dirty
    ? `${Number(state.changedFileCount || 0)} changed · ${Number(state.sessionChangedFileCount || 0)} from current session`
    : 'Clean';
  const validation = state.lastValidation
    ? `${state.lastValidation.status} · ${timeAgo(state.lastValidation.completedAt)}`
    : 'Not run yet';
  const activity = state.lastTask
    ? `${workSessionStateView(state.lastTask).label.toLowerCase()} · ${timeAgo(state.lastTask.completedAt || state.lastTask.startedAt)}`
    : 'No task history';
  return `<div class="workspace-operational">
    ${operationalItem('Branch', branchSummary(state))}
    ${operationalItem('Worktree', worktree)}
    ${operationalItem('Last validation', validation)}
    ${operationalItem('Last activity', activity)}
  </div>`;
}

function operationalItem(label, value) {
  return `<div><span>${esc(label)}</span><strong title="${esc(value)}">${esc(value)}</strong></div>`;
}

function branchSummary(operational) {
  if (!operational.branch) return operational.isGit ? 'Branch unavailable' : 'Git unavailable';
  if (!operational.ahead && !operational.behind) return operational.branch;
  return `${operational.branch} · ↑${Number(operational.ahead || 0)} ↓${Number(operational.behind || 0)}`;
}

function workspaceValidationHtml(view) {
  const commands = view.validationCommands;
  const ready = commands.length > 0;
  const commandHtml = ready
    ? `<div class="validation-command-list">${commands.map(command => `<code class="validation-command">${esc(command)}</code>`).join('')}</div>`
    : '<p class="workspace-validation-empty">No automatic validation command was detected. You can still use the workspace and configure project checks later.</p>';
  const statusPill = ready
    ? pillHtml('ready')
    : pillHtml('not configured');
  return `<section class="workspace-validation ${ready ? 'ready' : 'missing'}">
    <div class="workspace-validation-head">
      <div>
        <span class="workspace-section-label">Automatic validation</span>
        <strong>${ready ? `${commands.length} command${commands.length === 1 ? '' : 's'} will run` : 'Not configured'}</strong>
      </div>
      ${statusPill}
    </div>
    ${commandHtml}
  </section>`;
}

function workspacePolicyHtml(view) {
  const branches = view.protectedBranches.length ? view.protectedBranches.join(', ') : 'none';
  const remotes = view.allowedRemotes.length ? view.allowedRemotes.join(', ') : 'none';
  const instructions = view.projectInstructions.length ? view.projectInstructions.join(', ') : 'not configured';
  return `<div class="workspace-policy-grid">
    ${policyItem('Protected branches', branches)}
    ${policyItem('Default base branch', view.defaultBaseBranch)}
    ${policyItem('Allowed remotes', remotes)}
    ${policyItem('Project instructions', instructions)}
  </div>`;
}

function policyItem(label, value) {
  return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

export { workspaceDetailsHtml, branchSummary };
