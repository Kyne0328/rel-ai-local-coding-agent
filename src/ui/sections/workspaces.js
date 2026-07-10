// Workspaces section — configured repositories and validation setup
import { buildWorkspaces } from './workspace-cards.js';
import { bindWorkspaceActions } from './workspace-actions.js';

export function mountWorkspaces(container, data) {
  bindWorkspaceActions();
  container.innerHTML = '';
  container.appendChild(buildWorkspaces(data || {}));
}
