import { pillHtml } from '../../components/pill.js';
import { esc, formatDuration, timeAgo } from '../../utils.js';
import { getWorkspaceFilter, routeHref } from '../../router.js';
import { connectionStateFor, connectionSummary } from '../../connection-state.js';
import { taskProgressHtml } from '../../components/task-progress.js';
import { workSessionStateView } from '../../task-identity.js';

export function mountHome(container, data) {
  container.innerHTML = '';
  container.appendChild(buildOverview(data || {}));
}

export function updateHomeLiveState(container, data = {}) {
  const current = container.querySelector('.section');
  if (!current) return false;
  const next = buildOverview(data);
  syncHomeRegion(current, next, '[data-home-live-activity]', '[data-home-live-connection]');
  syncHomeRegion(current, next, '[data-home-live-connection]', '.layout-grid');
  syncHomeRegion(current, next, '[data-home-live-attention]', '.layout-grid');
  syncHomeRegion(current, next, '[data-home-live-sessions]');
  return true;
}

function syncHomeRegion(current, next, selector, beforeSelector = '') {
  const currentNode = current.querySelector(selector);
  const nextNode = next.querySelector(selector);
  if (currentNode && nextNode) {
    if (!currentNode.isEqualNode(nextNode)) currentNode.replaceWith(nextNode);
    return;
  }
  if (currentNode) {
    currentNode.remove();
    return;
  }
  if (!nextNode) return;
  const before = beforeSelector ? current.querySelector(beforeSelector) : null;
  current.insertBefore(nextNode, before);
}

function buildOverview(data) {
  const config = data.config || {};
  const health = data.health || {};
  const connection = data.connection || {};
  const workspaceFilter = getWorkspaceFilter();
  const allWorkspaces = orderOverviewWorkspaces(Array.isArray(config.workspaces) ? config.workspaces : []);
  const workspaces = workspaceFilter ? allWorkspaces.filter(workspace => workspace.alias === workspaceFilter) : allWorkspaces;
  const tasks = orderOverviewTasks((Array.isArray(data.tasks) ? data.tasks : []).filter(task => !workspaceFilter || task.workspace === workspaceFilter));
  const findings = actionableFindings(health);
  const endpoint = String(connection.chatgptMcpUrl || '');
  const connectionState = connectionStateFor(data);
  const effectiveEndpoint = connectionState.publicEndpoint?.status === 'available' ? endpoint : '';
  const bridgeState = resolveBridgeState({ endpoint: effectiveEndpoint, workspaces, findings, connectionState });

  const root = document.createElement('div');
  root.className = 'section';
  const taskCard = taskActivityCard(data.taskActivity, tasks[0]);
  if (taskCard) root.appendChild(taskCard);
  root.appendChild(connectionHero(bridgeState, effectiveEndpoint, workspaces));

  const attention = buildAttention(workspaces, findings, effectiveEndpoint);
  if (attention.length) root.appendChild(attentionCard(attention));

  const grid = document.createElement('div');
  grid.className = 'layout-grid';
  grid.appendChild(workspaceSummaryCard(workspaces));
  grid.appendChild(recentTasksCard(tasks));
  root.appendChild(grid);
  return root;
}

function resolveBridgeState({ endpoint, workspaces, findings, connectionState }) {
  const connection = connectionSummary(connectionState);
  if (connection.tone !== 'ok') {
    return {
      tone: connection.tone === 'bad' ? 'bad' : 'warn',
      kicker: 'Connection status',
      title: connection.title,
      description: connection.message
    };
  }
  if (!workspaces.length) {
    return {
      tone: 'warn',
      kicker: 'Workspace setup',
      title: 'Add a workspace to finish setup.',
      description: 'Rel.AI is running, but ChatGPT needs at least one configured repository before it can inspect or change local code.'
    };
  }
  if (!endpoint) {
    return {
      tone: 'warn',
      kicker: 'Secure connection',
      title: 'Publish the ChatGPT endpoint.',
      description: 'Your repositories are configured. Finish connection setup so ChatGPT can reach this machine over HTTPS.'
    };
  }
  if (findings.length) {
    return {
      tone: 'bad',
      kicker: 'Needs attention',
      title: 'Rel.AI is connected, but diagnostics found a problem.',
      description: 'The endpoint is available, but one or more workspace or configuration findings should be resolved before relying on automated changes.'
    };
  }
  return {
    tone: 'good',
    kicker: 'Connection ready',
    title: 'Rel.AI is available to ChatGPT.',
    description: 'The secure MCP endpoint is authenticated and reachable. Rel.AI reports observed tool calls exactly; it does not infer ChatGPT\'s private reasoning or claim that the overall chat request is finished.'
  };
}

function connectionHero(state, endpoint, workspaces) {
  const hero = document.createElement('section');
  hero.dataset.homeLiveConnection = '';
  const hasWorkspaces = workspaces.length > 0;
  let primaryAction = '<a class="buttonlike primary" href="#settings/connection">Set up connection</a>';
  let secondaryAction = '<a class="buttonlike secondary" href="#workspaces">Manage workspaces</a>';
  if (!hasWorkspaces) {
    primaryAction = '<a class="buttonlike primary" href="#workspaces">Add workspace</a>';
    secondaryAction = '<a class="buttonlike secondary" href="#settings/connection">Connection settings</a>';
  } else if (endpoint) {
    primaryAction = `<a class="buttonlike primary" href="${routeHref('tasks')}">Open work sessions</a>`;
  }
  hero.className = `overview-hero ${state.tone}`;
  hero.innerHTML = `
    <div class="overview-copy">
      <div class="overview-kicker">${esc(state.kicker)}</div>
      <h2 class="overview-title">${esc(state.title)}</h2>
      <p class="overview-description">${esc(state.description)}</p>
      <div class="overview-actions">
        ${primaryAction}
        ${secondaryAction}
      </div>
    </div>`;
  return hero;
}

function taskActivityCard(activity = {}, persistedTask = null) {
  const activeTasks = activeTaskList(activity);
  const active = activeTasks.length > 0;
  const completedWithWarnings = persistedTask?.status === 'completed' && Number(persistedTask?.failedToolCallCount ?? persistedTask?.failures ?? 0) > 0;
  if (!active && !['failed', 'blocked', 'attention', 'validation_failed'].includes(persistedTask?.status) && !completedWithWarnings) return null;
  const task = active ? primaryActiveTask(activeTasks) : persistedTask || activity.lastTask;
  if (!task) return null;
  const card = document.createElement('section');
  card.dataset.homeLiveActivity = '';
  if (active) renderObservedSessionCard(card, activity, activeTasks, task);
  else renderInactiveSessionCard(card, task);
  return card;
}

export function activeTaskList(activity = {}) {
  const tasks = Array.isArray(activity.tasks)
    ? activity.tasks
    : activity.taskId && activity.state !== 'idle'
      ? [activity]
      : [];
  return tasks.filter(task => !workSessionStateView(task).terminal);
}

function primaryActiveTask(tasks) {
  return tasks.find(item => Number(item.activeCalls || 0) > 0) || tasks[0];
}

function renderObservedSessionCard(card, activity, activeTasks, task) {
  const sessionCount = activeTasks.length;
  const activeCalls = activeTasks.reduce((sum, item) => sum + Number(item.activeCalls || 0), 0);
  const waiting = activeCalls === 0;
  const location = activeTaskLocation(activeTasks);
  const operation = task.currentActivity || task.operation || taskAction(task.lastTool || task.tool);
  let title = task.title || (waiting ? 'Work session open.' : operation);
  if (!task.title && !waiting && sessionCount > 1) title = `${activeCalls} Rel.AI tool calls are running.`;
  let description = waiting
    ? `${esc(task.currentStage || 'Planning next step')} · no Rel.AI tool call is executing now.`
    : `${esc(task.currentStage || operation)} in <strong>${esc(task.workspace || location)}</strong>.`;
  if (!waiting && sessionCount > 1) description = `${activeCalls} ${pluralLabel(activeCalls, 'active tool call')} across ${location}.`;
  const activityLabel = waiting
    ? `${statusLabel(task.status)} · no active call`
    : `${activeCalls} ${pluralLabel(activeCalls, 'active call')}`;
  card.className = `card task-overview ${waiting ? 'waiting' : 'active'}`;
  card.innerHTML = `
    <div class="task-overview-mark" aria-hidden="true">${waiting ? '…' : '<span class="task-overview-spinner"></span>'}</div>
    <div class="task-overview-copy">
      <div class="overview-kicker">Observed Rel.AI activity</div>
      <h3>${esc(title)}</h3>
      <p>${description}</p>
      ${taskProgressHtml(task.progress, task.status, { compact: true })}
    </div>
    <div class="task-overview-meta">
      <span>${activityLabel}</span>
      <strong data-clock-elapsed-start="${esc(task.startedAtIso || task.createdAt || task.startedAt || '')}">${formatDuration(Date.now() - (Date.parse(task.startedAtIso || task.createdAt || '') || Number(task.startedAt || Date.now())))}</strong>
    </div>`;
}

function renderInactiveSessionCard(card, task) {
  const attention = ['failed', 'blocked', 'attention', 'validation_failed'].includes(task.status);
  const completed = task.status === 'completed' && task.completionKnown === true;
  const failed = Number(task.failures || 0);
  const callCount = Number(task.calls || 0);
  let mark = '•';
  let title = 'Last work session is inactive';
  if (attention) {
    mark = '!';
    title = task.status === 'blocked'
      ? 'Last work session was blocked'
      : task.status === 'validation_failed'
        ? 'Last work session needs repair'
        : 'Last work session failed';
  } else if (completed) {
    mark = '✓';
    title = 'Work-session completion reported';
  }
  const failureText = failed
    ? completed
      ? ` · ${failed} warning${failed === 1 ? '' : 's'}`
      : ` · ${failed} failed`
    : '';
  let completionText = ' · overall ChatGPT completion not reported';
  if (completed) completionText = ` · ${esc(task.summary || 'final validation passed')}`;
  card.className = `card task-overview ${attention ? 'attention' : completed ? 'completed' : 'waiting'}`;
  card.innerHTML = `
    <div class="task-overview-mark" aria-hidden="true">${mark}</div>
    <div class="task-overview-copy">
      <div class="overview-kicker">Previous work session</div>
      <h3>${esc(task.title || title)}</h3>
      <p>${esc(task.workspace || 'workspace')} · ${callCount} ${pluralLabel(callCount, 'tool call')}${failureText}${completionText}</p>
      ${taskProgressHtml(task.progress, task.status, { compact: true })}
    </div>
    <div class="task-overview-meta"><span data-clock-relative="${esc(task.endedAt || task.completedAt || '')}">${esc(timeAgo(task.endedAt || task.completedAt))}</span><strong>${formatDuration(task.durationMs)}</strong></div>`;
}

function activeTaskLocation(tasks) {
  const workspaces = [...new Set(tasks.map(item => item.workspace).filter(Boolean))];
  if (workspaces.length === 1) return esc(workspaces[0]);
  if (workspaces.length > 1) return `${workspaces.length} workspaces`;
  return 'configured workspaces';
}

function pluralLabel(count, singular) {
  return Number(count) === 1 ? singular : `${singular}s`;
}

function taskAction(tool) {
  const value = String(tool || '');
  if (/run_checks|browser/.test(value)) return 'Validating changes';
  if (/diff|git_status/.test(value)) return 'Reviewing changes';
  if (/git_draft_pr|git_create_pr/.test(value)) return 'Preparing pull request text';
  if (/git_commit|git_push/.test(value)) return 'Publishing changes';
  if (/edit|write|replace|tidy_run|restore|reset_workspace/.test(value)) return 'Applying changes';
  return 'Inspecting the workspace';
}

export function buildAttention(workspaces, findings, endpoint) {
  const items = [];
  if (!workspaces.length) {
    items.push({ priority: 1, tone: 'warn', title: 'No workspaces configured', copy: 'Add the repository aliases ChatGPT should be allowed to use.', href: '#workspaces', cta: 'Add workspace' });
  }
  const missingValidation = workspaces.filter(ws => !hasValidation(ws));
  if (missingValidation.length) {
    items.push({ priority: 3, tone: 'warn', title: 'Validation is incomplete', copy: `${missingValidation.length} workspace${missingValidation.length === 1 ? '' : 's'} have no saved or detected check command.`, href: '#workspaces', cta: 'Review validation' });
  }
  if (!endpoint) {
    items.push({ priority: 2, tone: 'warn', title: 'ChatGPT endpoint unavailable', copy: 'Configure the permanent HTTPS tunnel before creating the ChatGPT app.', href: '#settings/connection', cta: 'Open connection' });
  }
  if (findings.length) {
    items.push({ priority: 0, tone: 'bad', title: 'Diagnostics need review', copy: `${findings.length} actionable finding${findings.length === 1 ? '' : 's'} may affect workspace access or reliability.`, href: '#settings/diagnostics', cta: 'Open diagnostics' });
  }
  return items
    .sort((left, right) => left.priority - right.priority || left.title.localeCompare(right.title, 'en-US', { sensitivity: 'base' }))
    .slice(0, 3)
    .map(({ priority: _priority, ...item }) => item);
}

function attentionCard(items) {
  const card = document.createElement('section');
  card.dataset.homeLiveAttention = '';
  card.className = 'card attention-card';
  card.innerHTML = '<div class="card-head"><h3>Needs attention</h3><span class="section-action">recommended next actions</span></div>';
  const body = document.createElement('div');
  body.className = 'card-body attention-list';
  body.innerHTML = items.map(item => `
    <div class="attention-item">
      <span class="attention-icon ${item.tone === 'bad' ? 'bad' : ''}"></span>
      <div><div class="attention-title">${esc(item.title)}</div><div class="attention-copy">${esc(item.copy)}</div></div>
      <a class="buttonlike secondary compact-button" href="${esc(item.href)}">${esc(item.cta)}</a>
    </div>`).join('');
  card.appendChild(body);
  return card;
}

function workspaceSummaryCard(workspaces) {
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h3>Workspaces</h3><a class="section-action" href="#workspaces">Manage</a></div>`;
  const body = document.createElement('div');
  body.className = 'card-body compact-workspace-list';
  body.innerHTML = workspaces.length
    ? workspaces.slice(0, 6).map(ws => `
      <div class="compact-workspace">
        <div><strong>${esc(ws.alias || 'workspace')}</strong><div class="compact-workspace-path">${esc(ws.path || '')}</div></div>
        ${pillHtml(hasValidation(ws) ? 'ready' : 'not configured')}
      </div>`).join('')
    : '<div class="empty">No workspaces configured. <a href="#workspaces">Add your first repository.</a></div>';
  card.appendChild(body);
  return card;
}

function recentTasksCard(tasks) {
  const card = document.createElement('section');
  card.dataset.homeLiveSessions = '';
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h3>Latest work sessions</h3><a class="section-action" href="${routeHref('tasks')}">Open session history</a></div>`;
  const body = document.createElement('div');
  body.className = 'card-body';
  body.innerHTML = tasks.slice(0, 5).map(task => {
    const status = recentTaskStatus(task.status);
    const endedAt = task.endedAt || task.completedAt;
    const time = endedAt ? timeAgo(endedAt) : 'now';
    const timeClock = endedAt ? `data-clock-relative="${esc(endedAt)}"` : '';
    const operation = task.operation || taskAction(task.lastTool);
    const warnings = task.status === 'completed' ? Number(task.failedToolCallCount ?? task.failures ?? 0) : 0;
    const warningText = warnings ? ` · ${warnings} warning${warnings === 1 ? '' : 's'}` : '';
    return `<div class="activity-row"><span class="activity-time" ${timeClock}>${esc(time)}</span><span class="activity-name truncate"><strong>${esc(task.title || operation)}</strong> · ${esc(task.workspace || 'workspace')} · ${esc(task.toolCallCount ?? task.calls ?? 0)} calls${warningText}</span>${status}</div>`;
  }).join('') || '<div class="empty">Work sessions appear after ChatGPT or the local dashboard starts an explicit repository objective.</div>';
  card.appendChild(body);
  return card;
}

function recentTaskStatus(status) {
  if (status === 'failed' || status === 'attention') return pillHtml('failed');
  if (status === 'blocked') return pillHtml('blocked');
  if (status === 'completed') return pillHtml('completed');
  if (status === 'running' || status === 'working') return pillHtml('running');
  if (status === 'validating') return pillHtml('validating');
  if (status === 'validation_failed') return pillHtml('validation failed');
  if (status === 'expired' || status === 'inactive') return pillHtml('expired');
  if (status === 'cancelled') return pillHtml('cancelled');
  if (['queued', 'planning', 'waiting_for_approval', 'waiting', 'settling'].includes(status)) return pillHtml('open');
  return pillHtml('unknown');
}

function statusLabel(status) {
  return String(status || 'open').replaceAll('_', ' ');
}

function hasValidation(workspace) {
  return Boolean((workspace.testCommandKeys || []).length || (workspace.discoveredTestCommandKeys || []).length);
}

function actionableFindings(health) {
  return Array.isArray(health.findings) ? health.findings.filter(item => item.severity !== 'info') : [];
}

export function orderOverviewTasks(tasks = []) {
  return [...(Array.isArray(tasks) ? tasks : [])].sort((left, right) => {
    const timestampDifference = overviewTimestamp(right) - overviewTimestamp(left);
    if (timestampDifference) return timestampDifference;
    return String(left?.id || '').localeCompare(String(right?.id || ''), 'en-US', { numeric: true, sensitivity: 'base' });
  });
}

export function orderOverviewWorkspaces(workspaces = []) {
  return [...(Array.isArray(workspaces) ? workspaces : [])].sort((left, right) =>
    String(left?.alias || '').localeCompare(String(right?.alias || ''), 'en-US', { numeric: true, sensitivity: 'base' })
  );
}

function overviewTimestamp(task) {
  const timestamp = Date.parse(task?.endedAt || task?.completedAt || task?.lastActivityAt || task?.startedAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}
