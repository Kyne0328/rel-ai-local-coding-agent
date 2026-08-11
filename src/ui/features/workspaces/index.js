// Workspaces section — configured repositories and validation setup
import { buildWorkspaces } from './cards.js';
import { bindWorkspaceActions } from './actions.js';
import { buildValidationPreferences } from './validation-preferences.js';

export function mountWorkspaces(container, data) {
  bindWorkspaceActions();
  container.innerHTML = '';
  const payload = data || {};
  const root = buildWorkspaces(payload);
  const toolbar = root.querySelector('.workspace-toolbar');
  const preferences = buildValidationPreferences(payload);
  if (toolbar) toolbar.after(preferences);
  else root.prepend(preferences);
  container.appendChild(root);
}
