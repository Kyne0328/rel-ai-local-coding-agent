import { pillHtml } from '../../components/pill.js';
import { esc, formatDuration, timeAgo } from '../../utils.js';
import { getWorkspaceFilter, routeHref } from '../../router.js';
import { connectionStateFor, connectionSummary, hasObservedMcpConnection, hasObservedMcpToolCall } from '../../connection-state.js';
import { taskProgressHtml } from '../../components/task-progress.js';
import { workSessionStateView } from '../../task-identity.js';
import { buildTaskSemanticProgress } from '../../../taskSemanticProgress.js';
import { completeDesktopSetup, createDesktopSetupChecklist, desktopSetupItems } from '../onboarding/index.js';
import { routeMetadata } from '../../navigation-catalog.js';
import { loadAnalyticsData } from '../usage/data.js';

let homeAnalyticsGeneration = 0;

export function mountHome(container, data) {
  container.innerHTML = '';
  const payload = data || {};
  container.appendChild(buildOverview(payload));
  void hydrateHomeAnalytics(container, { workspace: getWorkspaceFilter() });
  void finalizeSetupChecklist(payload);
}

export function updateHomeLiveState(container, data = {}) {
  const current = container.querySelector('.section');
  if (!current) return false;
  const state = overviewState(data);
  syncHomeRegion(current, taskActivityCard(data.taskActivity, state.tasks[0]), '[data-home-live-activity]', '[data-home-live-connection]');
  syncHomeInteractiveRegion(current, createDesktopSetupChecklist(desktopSetupState(data)), '[data-desktop-setup-checklist]', '[data-home-live-connection]');
  syncHomeRegion(current, connectionHero(state.bridgeState), '[data-home-live-connection]', '.layout-grid');
  syncHomeRegion(current, workspaceSummaryCard(state.workspaces, state.findings), '[data-home-live-workspaces]');
  syncHomeRegion(current, recentTasksCard(state.tasks), '[data-home-live-sessions]');
  refreshHomeAnalyticsAfterTaskBoundary(current, data);
  void finalizeSetupChecklist(data);
  return true;
}

function syncHomeInteractiveRegion(current, nextNode, selector, beforeSelector = '') {
  const currentNode = current.querySelector(selector);
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

function syncHomeRegion(current, nextNode, selector, beforeSelector = '') {
  const currentNode = current.querySelector(selector);
  if (currentNode && nextNode) {
    syncHomeClockText(currentNode, nextNode);
    if (!currentNode.isEqualNode(nextNode)) patchHomeNode(currentNode, nextNode);
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

function patchHomeNode(currentNode, nextNode) {
  if (currentNode.nodeType !== nextNode.nodeType || currentNode.nodeName !== nextNode.nodeName) {
    currentNode.replaceWith(nextNode);
    return;
  }
  if (currentNode.nodeType === Node.TEXT_NODE) {
    if (currentNode.nodeValue !== nextNode.nodeValue) currentNode.nodeValue = nextNode.nodeValue;
    return;
  }
  const currentAttributes = new Map([...currentNode.attributes].map(attribute => [attribute.name, attribute.value]));
  for (const attribute of nextNode.attributes) {
    if (currentAttributes.get(attribute.name) !== attribute.value) currentNode.setAttribute(attribute.name, attribute.value);
    currentAttributes.delete(attribute.name);
  }
  for (const name of currentAttributes.keys()) currentNode.removeAttribute(name);
  const currentChildren = [...currentNode.childNodes];
  const nextChildren = [...nextNode.childNodes];
  const shared = Math.min(currentChildren.length, nextChildren.length);
  for (let index = 0; index < shared; index += 1) patchHomeNode(currentChildren[index], nextChildren[index]);
  for (let index = shared; index < nextChildren.length; index += 1) currentNode.appendChild(nextChildren[index].cloneNode(true));
  while (currentNode.childNodes.length > nextChildren.length) currentNode.lastChild?.remove();
}

function syncHomeClockText(currentNode, nextNode) {
  const selector = '[data-clock-elapsed-start], [data-clock-relative]';
  const currentClocks = [...currentNode.querySelectorAll(selector)];
  const nextClocks = [...nextNode.querySelectorAll(selector)];
  for (let index = 0; index < Math.min(currentClocks.length, nextClocks.length); index += 1) {
    const currentClock = currentClocks[index];
    const nextClock = nextClocks[index];
    if (clockIdentity(currentClock) === clockIdentity(nextClock)) nextClock.textContent = currentClock.textContent;
  }
}

function clockIdentity(node) {
  return [
    node.getAttribute('data-clock-elapsed-start') || '',
    node.getAttribute('data-clock-elapsed-end') || '',
    node.getAttribute('data-clock-relative') || ''
  ].join('|');
}

function overviewState(data = {}) {
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
  return {
    workspaces,
    tasks,
    findings,
    effectiveEndpoint,
    bridgeState: resolveBridgeState({ endpoint: effectiveEndpoint, workspaces, findings, connectionState })
  };
}

function buildOverview(data) {
  const { workspaces, tasks, findings, bridgeState } = overviewState(data);
  const root = document.createElement('div');
  root.className = 'section';
  const taskCard = taskActivityCard(data.taskActivity, tasks[0]);
  if (taskCard) root.appendChild(taskCard);
  const setupChecklist = createDesktopSetupChecklist(desktopSetupState(data));
  if (setupChecklist) root.appendChild(setupChecklist);
  root.appendChild(connectionHero(bridgeState));

  root.appendChild(homeAnalyticsShell(analyticsTaskBoundary(tasks)));

  const grid = document.createElement('div');
  grid.className = 'layout-grid';
  grid.appendChild(workspaceSummaryCard(workspaces, findings));
  grid.appendChild(recentTasksCard(tasks));
  root.appendChild(grid);
  return root;
}

function resolveBridgeState({ findings, connectionState }) {
  const connection = connectionSummary(connectionState);
  if (connection.tone !== 'ok') {
    return {
      tone: connection.tone === 'bad' ? 'bad' : 'warn',
      kicker: 'Connection status',
      title: connection.title,
      description: connection.message
    };
  }
  if (findings.length) {
    return {
      tone: 'bad',
      kicker: 'Needs attention',
      title: 'Rel.AI is connected, but a problem needs attention.',
      description: 'Rel.AI can connect to ChatGPT, but one or more issues should be resolved before automated changes.'
    };
  }
  return {
    tone: 'good',
    kicker: 'Connection ready',
    title: 'ChatGPT can work on your projects.',
    description: 'Rel.AI is connected and ready for ChatGPT to use on your projects.'
  };
}

function connectionHero(state) {
  const hero = document.createElement('section');
  hero.dataset.homeLiveConnection = '';
  hero.className = `overview-hero overview-hero-compact ${state.tone}`;
  hero.innerHTML = `
    <div class="overview-copy">
      <div class="overview-kicker">${esc(state.kicker)}</div>
      <h2 class="overview-title">${esc(state.title)}</h2>
      <p class="overview-description">${esc(state.description)}</p>
    </div>
    <a class="buttonlike secondary compact-button" href="${routeMetadata('connection').href}">View connection</a>`;
  return hero;
}

function taskActivityCard(activity = {}, persistedTask = null) {
  const activeTasks = activeTaskList(activity);
  const active = activeTasks.length > 0;
  const completedWithWarnings = persistedTask?.status === 'completed' && Number(persistedTask?.failedToolCallCount ?? persistedTask?.failures ?? 0) > 0;
  if (!active && !['failed', 'blocked', 'validation_failed'].includes(persistedTask?.status) && !completedWithWarnings) return null;
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
  const semantic = semanticProgressFor(task);
  const operation = semantic.currentActivity || task.currentActivity || task.operation || taskAction(task.lastTool || task.tool);
  let title = task.title || operation || 'Current task';
  if (!task.title && !waiting && sessionCount > 1) title = `${activeCalls} Rel.AI actions are running.`;
  let description = semanticTaskDescription(semantic, task.workspace || location);
  if (!waiting && sessionCount > 1) description = `${activeCalls} ${pluralLabel(activeCalls, 'active action')} across ${location}.`;
  const activityLabel = waiting
    ? `${statusLabel(task.status)} · latest progress`
    : `${activeCalls} ${pluralLabel(activeCalls, 'active call')}`;
  card.className = `card task-overview ${waiting ? 'waiting' : 'active'}`;
  card.innerHTML = `
    <div class="task-overview-mark" aria-hidden="true">${waiting ? '…' : '<span class="task-overview-spinner"></span>'}</div>
    <div class="task-overview-copy">
      <div class="overview-kicker">Current task</div>
      <h3>${esc(title)}</h3>
      <p>${description}</p>
      ${taskProgressHtml(task.progress, task.status, { compact: true })}
    </div>
    <div class="task-overview-meta">
      <span>${activityLabel}</span>
      <strong data-clock-elapsed-start="${esc(task.startedAtIso || task.createdAt || task.startedAt || '')}">${formatDuration(Date.now() - (Date.parse(task.startedAtIso || task.createdAt || '') || Number(task.startedAt || Date.now())), { live: true })}</strong>
    </div>`;
}

function renderInactiveSessionCard(card, task) {
  const attention = ['failed', 'blocked', 'validation_failed'].includes(task.status);
  const completed = task.status === 'completed' && task.completionKnown === true;
  const failed = Number(task.failures || 0);
  const callCount = Number(task.calls || 0);
  let mark = '•';
  let title = 'Last task is inactive';
  if (attention) {
    mark = '!';
    title = task.status === 'blocked'
      ? workSessionStateView(task).label === 'Final validation required' ? 'Last task needs final validation' : 'Last task was blocked'
      : task.status === 'validation_failed'
        ? 'Last task needs attention'
        : 'Last task failed';
  } else if (completed) {
    mark = '✓';
    title = 'Task completed';
  }
  const failureText = failed
    ? completed
      ? ` · ${failed} warning${failed === 1 ? '' : 's'}`
      : ` · ${failed} failed`
    : '';
  let completionText = ' · ChatGPT did not report a final result';
  if (completed) completionText = ` · ${esc(task.summary || 'final checks passed')}`;
  card.className = `card task-overview ${attention ? 'attention' : completed ? 'completed' : 'waiting'}`;
  card.innerHTML = `
    <div class="task-overview-mark" aria-hidden="true">${mark}</div>
    <div class="task-overview-copy">
      <div class="overview-kicker">Previous task</div>
      <h3>${esc(task.title || title)}</h3>
      <p>${esc(task.workspace || 'project')} · ${callCount} ${pluralLabel(callCount, 'action')}${failureText}${completionText}</p>
      ${taskProgressHtml(task.progress, task.status, { compact: true })}
    </div>
    <div class="task-overview-meta"><span data-clock-relative="${esc(task.endedAt || task.completedAt || '')}">${esc(timeAgo(task.endedAt || task.completedAt))}</span><strong>${formatDuration(task.durationMs)}</strong></div>`;
}

function semanticProgressFor(task = {}) {
  if (task.semanticProgress && typeof task.semanticProgress === 'object') return task.semanticProgress;
  return buildTaskSemanticProgress(task);
}

function semanticTaskDescription(semantic = {}, workspace = '') {
  const stage = String(semantic.currentStage || 'Task progress').trim();
  const activity = String(semantic.currentActivity || '').trim();
  const location = String(workspace || '').trim();
  const progress = activity && activity !== stage ? `${esc(stage)} · ${esc(activity)}` : esc(stage || activity || 'Task is open');
  return location ? `${progress} in <strong>${esc(location)}</strong>.` : `${progress}.`;
}

function activeTaskLocation(tasks) {
  const workspaces = [...new Set(tasks.map(item => item.workspace).filter(Boolean))];
  if (workspaces.length === 1) return esc(workspaces[0]);
  if (workspaces.length > 1) return `${workspaces.length} projects`;
  return 'your projects';
}

function pluralLabel(count, singular) {
  return Number(count) === 1 ? singular : `${singular}s`;
}

function taskAction(tool) {
  const value = String(tool || '');
  if (/run_checks|browser/.test(value)) return 'Checking changes';
  if (/diff|git_status/.test(value)) return 'Reviewing changes';
  if (/git_draft_pr|git_create_pr/.test(value)) return 'Preparing pull request text';
  if (/git_commit|git_push/.test(value)) return 'Publishing changes';
  if (/edit|write|replace|tidy_run|restore|reset_workspace/.test(value)) return 'Applying changes';
  return 'Looking through the project';
}

function homeAnalyticsShell(taskBoundary = '') {
  const card = document.createElement('section');
  card.className = 'card home-analytics-card';
  card.dataset.homeAnalytics = '';
  card.dataset.taskBoundary = taskBoundary;
  card.setAttribute('aria-busy', 'true');
  card.innerHTML = `
    <div class="card-head home-analytics-head">
      <div><h3>Activity</h3><p>Loading activity…</p></div>
      <a class="buttonlike secondary compact-button" href="${routeHref('usage')}">View analytics</a>
    </div>
    <div class="home-analytics-loading" aria-hidden="true"><span></span><span></span><span></span><span></span></div>`;
  return card;
}

export async function hydrateHomeAnalytics(root, { desktop = globalThis.window?.relaiDesktop, now = new Date(), workspace = '' } = {}) {
  const target = root?.querySelector?.('[data-home-analytics]');
  if (!target) return false;
  const generation = ++homeAnalyticsGeneration;
  target.setAttribute?.('aria-busy', 'true');
  try {
    const { current } = await loadAnalyticsData({ desktop, range: '24h', now, workspace });
    if (generation !== homeAnalyticsGeneration || (typeof target.isConnected === 'boolean' && !target.isConnected)) return false;
    target.innerHTML = homeAnalyticsHtml(current);
    target.setAttribute?.('aria-busy', 'false');
    return true;
  } catch {
    if (generation !== homeAnalyticsGeneration || (typeof target.isConnected === 'boolean' && !target.isConnected)) return false;
    target.innerHTML = homeAnalyticsUnavailableHtml(workspace);
    target.setAttribute?.('aria-busy', 'false');
    return false;
  }
}

export function homeAnalyticsHtml(scope = {}) {
  const completed = Number(scope.completed || 0);
  const actions = Number(scope.toolCalls || 0);
  const reliabilityCalls = Number(scope.reliabilityCalls || 0);
  const systemErrors = Number(scope.infrastructureFailures || 0);
  const workspaceScoped = scope.kind === 'workspace';
  const activeProjects = (Array.isArray(scope.workspaces) ? scope.workspaces : []).filter(item => Number(item.toolCalls || 0) > 0).length;
  const metricFour = workspaceScoped
    ? homeAnalyticsMetric('Total execution time', completed ? formatAnalyticsDuration(scope.executionMs) : '—')
    : homeAnalyticsMetric('Active projects', formatInteger(activeProjects));
  const heading = workspaceScoped ? `${scope.label} activity` : 'Activity';
  const href = routeHref('usage', workspaceScoped ? { workspace: scope.workspace } : {});
  const errorSummary = systemErrors
    ? `${formatInteger(systemErrors)} system ${pluralLabel(systemErrors, 'error')}`
    : 'No system errors';
  const contextSummary = analyticsContextSummary(scope, actions);
  return `
    <div class="card-head home-analytics-head">
      <div><div class="home-analytics-title-row"><h3>${esc(heading)}</h3><span>Last 24 hours</span></div></div>
      <a class="buttonlike secondary compact-button" href="${href}">View analytics</a>
    </div>
    <div class="home-analytics-body">
      <div class="home-analytics-metrics">
        ${homeAnalyticsMetric('Actions', formatInteger(actions))}
        ${homeAnalyticsMetric('Reliable actions', reliabilityCalls ? formatPercent(scope.reliabilityRate) : '—', reliabilityCalls ? `${formatInteger(reliabilityCalls)} measured` : 'Measured after new actions run')}
        ${homeAnalyticsMetric('Average time', completed ? formatAnalyticsDuration(scope.averageDuration) : '—', completed ? 'Per completed action' : '')}
        ${metricFour}
      </div>
      <div class="home-analytics-pulse">
        <div class="home-analytics-pulse-head"><div><span>Hourly activity</span><strong>${esc(contextSummary)}</strong></div><small>UTC</small></div>
        ${homeAnalyticsPulse(scope.points)}
      </div>
      <div class="home-analytics-foot"><span>${esc(errorSummary)}</span></div>
    </div>`;
}

function homeAnalyticsUnavailableHtml(workspace = '') {
  return `
    <div class="card-head home-analytics-head">
      <div><h3>Activity</h3><p>Activity could not be loaded.</p></div>
      <a class="buttonlike secondary compact-button" href="${routeHref('usage', workspace ? { workspace } : {})}">Open analytics</a>
    </div>`;
}

function homeAnalyticsMetric(label, value, detail = '') {
  const detailHtml = detail ? `<small>${esc(detail)}</small>` : '';
  return `<div class="home-analytics-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong>${detailHtml}</div>`;
}

function homeAnalyticsPulse(points = []) {
  const values = (Array.isArray(points) ? points : []).map(point => Number(point?.toolCalls || 0)).map(value => Number.isFinite(value) && value >= 0 ? value : 0);
  if (!values.length || values.every(value => value === 0)) return '<div class="home-analytics-pulse-empty">No activity yet.</div>';
  const width = 720;
  const height = 112;
  const baseline = height - 10;
  const max = Math.max(...values, 1);
  const pointsValue = values.map((value, index) => `${values.length === 1 ? width / 2 : index / (values.length - 1) * width},${baseline - value / max * (height - 28)}`).join(' ');
  const area = `0,${baseline} ${pointsValue} ${width},${baseline}`;
  const total = values.reduce((sum, value) => sum + value, 0);
  const latest = values.at(-1) || 0;
  const peak = Math.max(...values);
  const peakIndex = values.indexOf(peak);
  const hoursAgo = Math.max(0, values.length - 1 - peakIndex);
  const trend = latest > values[0] ? 'increasing' : latest < values[0] ? 'decreasing' : 'steady';
  const summary = `Action activity over the last 24 hours. ${formatInteger(total)} total actions. Peak ${formatInteger(peak)} ${pluralLabel(peak, 'action')} ${hoursAgo ? `${hoursAgo} ${pluralLabel(hoursAgo, 'hour')} ago` : 'in the latest hour'}. Latest hour ${formatInteger(latest)} ${pluralLabel(latest, 'action')}. Overall trend ${trend}.`;
  return `<div class="home-analytics-chart"><svg class="home-analytics-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(summary)}"><line x1="0" y1="${height * .32}" x2="${width}" y2="${height * .32}" class="home-analytics-gridline"/><line x1="0" y1="${height * .62}" x2="${width}" y2="${height * .62}" class="home-analytics-gridline"/><polygon points="${area}" class="home-analytics-area"/><polyline points="${pointsValue}" class="home-analytics-line" fill="none" vector-effect="non-scaling-stroke"/></svg><div class="home-analytics-scale"><span>24h ago</span><span>Now</span></div></div>`;
}

function analyticsContextSummary(scope = {}, actions = 0) {
  const topProject = Array.isArray(scope.workspaces) ? scope.workspaces[0] : null;
  if (!actions) return 'No activity';
  if (scope.kind !== 'workspace' && topProject?.workspace) return `Most active project: ${topProject.workspace}`;
  return `${formatInteger(actions)} ${pluralLabel(actions, 'action')} in the last 24 hours`;
}

function refreshHomeAnalyticsAfterTaskBoundary(root, data = {}) {
  const target = root.querySelector?.('[data-home-analytics]');
  if (!target) return;
  const tasks = orderOverviewTasks(Array.isArray(data.tasks) ? data.tasks : []);
  const boundary = analyticsTaskBoundary(tasks);
  if (!boundary || target.dataset.taskBoundary === boundary) return;
  target.dataset.taskBoundary = boundary;
  void hydrateHomeAnalytics(root, { workspace: getWorkspaceFilter() });
}

function analyticsTaskBoundary(tasks = []) {
  const task = tasks.find(item => item?.endedAt || item?.completedAt);
  return String(task?.endedAt || task?.completedAt || '');
}

function formatInteger(value) {
  return Math.floor(Number(value) || 0).toLocaleString();
}

function formatPercent(value) {
  const number = Number(value) || 0;
  return `${number.toFixed(number >= 10 ? 1 : 2)}%`;
}

function formatAnalyticsDuration(value) {
  const milliseconds = Math.max(0, Number(value) || 0);
  if (milliseconds < 1000) return `${Math.floor(milliseconds)} ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} s`;
  const minutes = seconds / 60;
  return `${minutes.toFixed(minutes >= 10 ? 1 : 2)} min`;
}

function workspaceSummaryCard(workspaces, findings) {
  const card = document.createElement('section');
  card.dataset.homeLiveWorkspaces = '';
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h3>Projects</h3><a class="section-action" href="${routeMetadata('workspaces').href}">Manage</a></div>`;
  const body = document.createElement('div');
  body.className = 'card-body compact-workspace-list';
  body.innerHTML = workspaces.length
    ? workspaces.slice(0, 6).map(ws => `
      <div class="compact-workspace">
        <div><strong>${esc(ws.alias || 'project')}</strong><div class="compact-workspace-path">${esc(ws.path || '')}</div></div>
        ${pillHtml(overviewWorkspaceStatus(ws, findings))}
      </div>`).join('')
    : `<div class="empty">No projects added yet. <a class="buttonlike secondary compact-button" href="${routeMetadata('workspaces').href}">Add your first project</a></div>`;
  card.appendChild(body);
  return card;
}

function recentTasksCard(tasks) {
  const card = document.createElement('section');
  card.dataset.homeLiveSessions = '';
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h3>Latest tasks</h3><a class="section-action" href="${routeHref('tasks')}">See all tasks</a></div>`;
  const body = document.createElement('div');
  body.className = 'card-body';
  body.innerHTML = tasks.slice(0, 5).map(task => {
    const status = recentTaskStatus(task);
    const endedAt = task.endedAt || task.completedAt;
    const time = endedAt ? timeAgo(endedAt) : 'now';
    const timeClock = endedAt ? `data-clock-relative="${esc(endedAt)}"` : '';
    const operation = task.operation || taskAction(task.lastTool);
    const warnings = task.status === 'completed' ? Number(task.failedToolCallCount ?? task.failures ?? 0) : 0;
    const warningText = warnings ? ` · ${warnings} warning${warnings === 1 ? '' : 's'}` : '';
    const taskId = String(task.id || task.taskId || task.work_id || '').trim();
    const href = routeHref('tasks', { workspace: task.workspace || '', task: taskId });
    return `<a class="activity-row" href="${esc(href)}"><span class="activity-time" ${timeClock}>${esc(time)}</span><span class="activity-name truncate"><strong>${esc(task.title || operation)}</strong> · ${esc(task.workspace || 'project')} · ${esc(task.toolCallCount ?? task.calls ?? 0)} actions${warningText}</span>${status}</a>`;
  }).join('') || '<div class="empty">Tasks will appear here after ChatGPT starts using Rel.AI on a project.</div>';
  card.appendChild(body);
  return card;
}

function recentTaskStatus(task) {
  const status = String(task?.status || '');
  if (status === 'failed') return pillHtml('failed');
  if (status === 'blocked') {
    const state = workSessionStateView(task);
    return pillHtml(state.label.toLowerCase(), state.pillClass);
  }
  if (status === 'completed') return pillHtml('completed');
  if (status === 'running' || status === 'working') return pillHtml('running');
  if (status === 'validating') return pillHtml('validating');
  if (status === 'validation_failed') return pillHtml('validation failed');
  if (status === 'expired') return pillHtml('expired');
  if (status === 'inactive') return pillHtml('inactive');
  if (status === 'cancelled') return pillHtml('cancelled');
  if (['queued', 'planning', 'waiting_for_approval', 'waiting', 'settling'].includes(status)) return pillHtml('open');
  return pillHtml('unknown');
}

function statusLabel(status) {
  return String(status || 'open').replaceAll('_', ' ');
}

export function overviewWorkspaceStatus(workspace = {}, findings = []) {
  const alias = String(workspace.alias || '');
  if (alias && findings.some(finding => finding?.workspace === alias)) return 'needs attention';
  if (workspace.operational?.exists === false) return 'unavailable';
  if (workspace.operational?.currentActivity || workspace.sessionPolicy?.sessionActive) return 'active';
  return 'ready';
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


function desktopSetupState(data = {}) {
  const workspaces = Array.isArray(data.config?.workspaces) ? data.config.workspaces : [];
  const state = connectionStateFor(data);
  const mcpConnection = data.mcpConnection || state.mcpClient || {};
  return {
    hasWorkspace: workspaces.length > 0,
    endpointReady: state.localService?.status === 'running' && state.publicEndpoint?.status === 'available',
    chatgptReady: hasObservedMcpConnection(mcpConnection),
    firstRequestObserved: hasObservedMcpToolCall(mcpConnection),
    connectionMode: 'secure_tunnel',
    workspaceAlias: workspaces[0]?.alias || 'myapp'
  };
}

async function finalizeSetupChecklist(data = {}) {
  const items = desktopSetupItems(desktopSetupState(data));
  if (!items.length) await completeDesktopSetup();
}
