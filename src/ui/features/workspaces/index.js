// Workspaces section — configured project folders and repository status
import { buildWorkspaces } from './cards.js';
import { bindWorkspaceActions } from './actions.js';

export function mountWorkspaces(container, data) {
  bindWorkspaceActions();
  container.innerHTML = '';
  container.appendChild(buildWorkspaces(data || {}));
}
