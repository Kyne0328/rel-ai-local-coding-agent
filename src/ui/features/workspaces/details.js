import { esc, timeAgo } from '../../utils.js';
import { workSessionStateView } from '../../task-identity.js';

function workspaceOperationalHtml(view) {
  const state = view?.operational || {};
  const validation = state.lastValidation
    ? `${state.lastValidation.status} · ${timeAgo(state.lastValidation.completedAt)}`
    : 'Not run yet';
  const activity = state.lastTask
    ? `${workSessionStateView(state.lastTask).label.toLowerCase()} · ${timeAgo(state.lastTask.completedAt || state.lastTask.startedAt)}`
    : 'No task history';
  if (!state.isGit) {
    return `<div class="workspace-operational">
      ${operationalItem('Git', 'Not initialized')}
      ${operationalItem('Last checks', validation)}
      ${operationalItem('Last activity', activity)}
    </div>`;
  }
  const worktree = state.dirty
    ? `${Number(state.changedFileCount || 0)} changed · ${Number(state.sessionChangedFileCount || 0)} from current session`
    : 'Clean';
  return `<div class="workspace-operational">
    ${operationalItem('Branch', branchSummary(state))}
    ${operationalItem('File changes', worktree)}
    ${operationalItem('Last checks', validation)}
    ${operationalItem('Last activity', activity)}
  </div>`;
}

function operationalItem(label, value) {
  return `<div><span>${esc(label)}</span><strong title="${esc(value)}">${esc(value)}</strong></div>`;
}

function branchSummary(operational) {
  if (!operational.branch) return operational.isGit ? 'Branch unavailable' : 'Git not initialized';
  if (!operational.ahead && !operational.behind) return operational.branch;
  return `${operational.branch} · ↑${Number(operational.ahead || 0)} ↓${Number(operational.behind || 0)}`;
}

export { workspaceOperationalHtml, branchSummary };
