// Workspaces section — configured project folders and repository status
import { buildWorkspaces } from './cards.js';
import { bindWorkspaceActions } from './actions.js';
import { hydrateWorkspaceAnalytics } from './analytics.js';

let liveAnalyticsTimer = 0;

export function mountWorkspaces(container, data) {
  bindWorkspaceActions();
  clearLiveAnalyticsTimer();
  container.innerHTML = '';
  container.appendChild(buildWorkspaces(data || {}));
}

export function updateWorkspacesLiveState(container, data = {}) {
  const current = container.querySelector('.section');
  if (!current) return false;
  const next = buildWorkspaces(data, { hydrateAnalytics: false });
  copyWorkspaceUiState(current, next);
  let mounted = current;
  if (!current.isEqualNode(next)) {
    current.replaceWith(next);
    mounted = next;
  }
  scheduleWorkspaceAnalytics(mounted, data.config?.workspaces || []);
  return true;
}

function copyWorkspaceUiState(current, next) {
  const analytics = new Map([...current.querySelectorAll('[data-workspace-analytics]')]
    .map(node => [node.dataset.workspaceAnalytics || '', node]));
  for (const target of next.querySelectorAll('[data-workspace-analytics]')) {
    const source = analytics.get(target.dataset.workspaceAnalytics || '');
    if (!source) continue;
    target.innerHTML = source.innerHTML;
    target.hidden = source.hidden;
  }
  for (const currentCard of current.querySelectorAll('[data-workspace-card]')) {
    const alias = currentCard.dataset.workspaceCard || '';
    const nextCard = [...next.querySelectorAll('[data-workspace-card]')]
      .find(card => card.dataset.workspaceCard === alias);
    if (!nextCard) continue;
    const currentMenu = currentCard.querySelector('.workspace-action-menu');
    const nextMenu = nextCard.querySelector('.workspace-action-menu');
    if (currentMenu && nextMenu) nextMenu.open = currentMenu.open;
  }
}

function scheduleWorkspaceAnalytics(root, workspaces) {
  clearLiveAnalyticsTimer();
  const aliases = (Array.isArray(workspaces) ? workspaces : []).map(workspace => String(workspace?.alias || '')).filter(Boolean);
  if (!aliases.length) return;
  liveAnalyticsTimer = window.setTimeout(() => {
    liveAnalyticsTimer = 0;
    const grid = root.isConnected ? root.querySelector('.workspace-grid') : null;
    if (grid) void hydrateWorkspaceAnalytics(grid, aliases);
  }, 180);
}

function clearLiveAnalyticsTimer() {
  if (!liveAnalyticsTimer) return;
  window.clearTimeout(liveAnalyticsTimer);
  liveAnalyticsTimer = 0;
}
