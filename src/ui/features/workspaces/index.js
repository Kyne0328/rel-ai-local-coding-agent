// Workspaces section — configured repositories and validation setup
import { buildWorkspaces } from './cards.js';
import { bindWorkspaceActions } from './actions.js';

export function mountWorkspaces(container, data) {
  bindWorkspaceActions();
  container.innerHTML = '';
  const root = buildWorkspaces(data || {});
  container.appendChild(root);
}
