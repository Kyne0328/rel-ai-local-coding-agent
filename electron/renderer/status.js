let currentStatus = {
  serverRunning: false,
  tunnelStatus: 'stopped',
  tunnelId: '',
  localMcpUrl: '',
  error: '',
  localUrl: '',
  version: '',
  taskActivity: { state: 'idle', activeCalls: 0, activeTaskCount: 0, tasks: [], workspace: '', tool: '', operation: '', completionKnown: false, startedAt: null, lastTask: null }
};
let previousAnnouncementKey = '';
let notificationsEnabled = localStorage.getItem('relai_status_notifications') !== 'off';
let clockTimer = null;
const serviceLogs = [];

function requestWindowFit() {
  window.requestAnimationFrame(() => {
    const shell = document.querySelector('.status-shell');
    if (!shell || typeof window.electronAPI?.fitWindowToContent !== 'function') return;
    window.electronAPI.fitWindowToContent({
      width: Math.ceil(shell.getBoundingClientRect().width),
      height: Math.ceil(document.documentElement.scrollHeight)
    });
  });
}

function connectionView(status) {
  if (status.serverRunning && status.tunnelStatus === 'running') {
    return {
      key: 'ready', badge: 'Ready', eyebrow: 'Connection ready',
      title: 'Rel.AI is available to ChatGPT.',
      description: 'The local MCP service and OpenAI Secure MCP Tunnel are ready. Rel.AI reports exact tool activity, but it cannot observe ChatGPT reasoning or infer when the overall chat request is finished.'
    };
  }
  if (status.serverRunning && status.tunnelStatus === 'connecting') {
    return {
      key: 'connecting', badge: 'Connecting', eyebrow: 'Secure connection',
      title: 'Connecting OpenAI Secure MCP Tunnel…',
      description: 'The local service is running while Rel.AI establishes the outbound tunnel.'
    };
  }
  if (status.error || status.tunnelStatus === 'failed') {
    return {
      key: 'failed', badge: 'Needs attention', eyebrow: 'Connection failed',
      title: 'Rel.AI could not finish connecting.',
      description: 'Review the error below, choose Edit connection if needed, then retry.'
    };
  }
  return {
    key: 'stopped', badge: 'Stopped', eyebrow: 'Service stopped',
    title: 'Rel.AI is not running.',
    description: 'Start the service to make your configured workspaces available to ChatGPT.'
  };
}

function heroView(status) {
  const activity = status.taskActivity || {};
  const taskCount = Math.max(1, Number(activity.activeTaskCount || activity.tasks?.length || 0));
  if (activity.state === 'working') return workingHero(activity, taskCount);
  if (activity.state === 'waiting' || activity.state === 'settling') return waitingHero(activity, taskCount);
  return connectionView(status);
}

function workingHero(activity, taskCount) {
  const title = taskCount > 1
    ? `${activity.activeCalls || taskCount} Rel.AI tool calls are running.`
    : activity.operation || toolLabel(activity.tool);
  return {
    key: 'working',
    badge: `${activity.activeCalls || taskCount} running`,
    eyebrow: 'Observed Rel.AI activity',
    title,
    description: activityDescription(activity, false)
  };
}

function waitingHero(activity, taskCount) {
  return {
    key: 'waiting',
    badge: `${taskCount} waiting`,
    eyebrow: 'Observed Rel.AI activity',
    title: 'No Rel.AI tool call is active.',
    description: activityDescription(activity, true)
  };
}

function activityDescription(activity, waiting) {
  const tasks = Array.isArray(activity.tasks) ? activity.tasks : [];
  const taskCount = Number(activity.activeTaskCount || tasks.length || 1);
  const activeCalls = Number(activity.activeCalls || 0);
  const location = activityLocation(activity, tasks);
  if (waiting) return 'ChatGPT may still be reasoning, waiting for approval, or already finished. Rel.AI cannot determine that from tool traffic alone.';
  if (taskCount > 1) return `${activeCalls} ${pluralize(activeCalls, 'active tool call')} across ${location}. The computer stays awake while calls are running.`;
  return `${activity.operation || toolLabel(activity.tool)} in ${location}. The computer stays awake until the tool call returns.`;
}

function activityLocation(activity, tasks) {
  const workspaces = [...new Set(tasks.map(task => task.workspace).filter(Boolean))];
  if (workspaces.length === 1) return workspaces[0];
  if (workspaces.length > 1) return `${workspaces.length} workspaces`;
  return activity.workspace || 'configured workspaces';
}

function pluralize(count, singular) {
  return Number(count) === 1 ? singular : `${singular}s`;
}

function toolLabel(tool) {
  if (tool === 'relai_exec') return 'Running a workspace command';
  if (tool === 'relai_run_checks' || tool === 'relai_http_probe') return 'Validating changes';
  if (tool === 'relai_diff') return 'Reviewing changes';
  if (tool === 'relai_git_draft_pr') return 'Preparing pull request text';
  if (tool === 'relai_git_commit' || tool === 'relai_git_push') return 'Publishing changes';
  if (tool === 'relai_edit' || tool === 'relai_tidy_run' || tool === 'relai_restore_paths' || tool === 'relai_reset_workspace') return 'Applying changes';
  return 'Inspecting the workspace';
}

function updateUI(status) {
  currentStatus = { ...currentStatus, ...(status || {}) };
  currentStatus.taskActivity = { ...currentStatus.taskActivity, ...(status?.taskActivity || {}) };
  const view = heroView(currentStatus);

  const badge = document.getElementById('statusBadge');
  badge.className = `status-badge ${view.key}`;
  badge.textContent = view.badge;
  document.getElementById('statusHero').dataset.state = view.key;
  document.getElementById('statusEyebrow').textContent = view.eyebrow;
  document.getElementById('statusTitle').textContent = view.title;
  document.getElementById('statusDescription').textContent = view.description;
  announceStatus(view);

  renderTaskMeta();
  renderEndpoint(view);
  renderConnectionHealth();
  renderLastTask();
  renderError(view);
  renderControls();
  ensureClock();
  requestWindowFit();
}

function announceStatus(view) {
  const key = `${view.key}|${view.title}|${view.description}`;
  if (key === previousAnnouncementKey) return;
  previousAnnouncementKey = key;
  const announcer = document.getElementById('statusAnnouncer');
  if (announcer) announcer.textContent = `${view.title} ${view.description}`;
}

function renderTaskMeta() {
  const activity = currentStatus.taskActivity || {};
  const element = document.getElementById('taskMeta');
  const active = activity.state === 'working' || activity.state === 'waiting' || activity.state === 'settling';
  element.hidden = !active;
  if (!active) return;
  const tasks = Array.isArray(activity.tasks) ? activity.tasks : [];
  const taskCount = Number(activity.activeTaskCount || tasks.length || 1);
  const activeCalls = Number(activity.activeCalls || 0);
  const calls = activity.state === 'working'
    ? `${activeCalls} ${pluralize(activeCalls, 'active call')}`
    : 'no active Rel.AI call';
  const workspace = activityLocation(activity, tasks);
  const taskLabel = `${taskCount} ${pluralize(taskCount, 'logical task')}`;
  element.innerHTML = `<span class="activity-pulse" aria-hidden="true"></span><strong>${escapeText(taskLabel)}</strong><span>${escapeText(workspace)}</span><span>${escapeText(calls)}</span><time id="taskElapsed"></time>`;
  renderTemporalText();
}

function renderEndpoint(view) {
  const endpoint = document.getElementById('mcpUrl');
  const copyButton = document.getElementById('copyBtn');
  const wrap = document.getElementById('endpointWrap');
  wrap.classList.toggle('compact', view.key === 'working' || view.key === 'waiting' || view.key === 'settling');
  if (currentStatus.tunnelId) {
    endpoint.textContent = currentStatus.tunnelId;
    endpoint.className = 'endpoint-box';
    copyButton.disabled = false;
  } else {
    endpoint.textContent = 'Waiting for tunnel configuration…';
    if (view.key === 'stopped') endpoint.textContent = 'Configure a Secure MCP Tunnel, then start the service.';
    endpoint.className = 'endpoint-box empty';
    copyButton.disabled = true;
  }
}

function renderConnectionHealth() {
  setHealthCard('localHealthCard', currentStatus.serverRunning ? 'ready' : 'offline');
  document.getElementById('localHealthState').textContent = currentStatus.serverRunning ? 'Running' : 'Stopped';
  document.getElementById('localService').textContent = currentStatus.localUrl || (currentStatus.serverRunning ? 'Running locally' : 'Not running');

  const publicState = publicHealthState(currentStatus.tunnelStatus);
  setHealthCard('publicHealthCard', publicState);
  document.getElementById('publicHealthState').textContent = tunnelLabel(currentStatus.tunnelStatus);
  document.getElementById('tunnelDetail').textContent = tunnelDetail(publicState, currentStatus.tunnelId);
}

function publicHealthState(tunnelStatus) {
  if (tunnelStatus === 'running') return 'ready';
  if (tunnelStatus === 'failed') return 'failed';
  if (tunnelStatus === 'connecting') return 'connecting';
  return 'offline';
}

function tunnelDetail(publicState, tunnelId) {
  if (publicState === 'ready' && tunnelId) return tunnelId;
  if (publicState === 'connecting') return 'Connecting to OpenAI';
  return tunnelId || 'Not configured';
}

function setHealthCard(id, state) {
  const card = document.getElementById(id);
  card.className = `app-card status-health-card ${state}`;
}

function renderLastTask() {
  const task = currentStatus.taskActivity?.lastTask;
  const card = document.getElementById('lastTaskCard');
  card.hidden = !task;
  if (!task) return;
  const attention = task.status === 'attention';
  const completed = task.status === 'completed' && task.completionKnown === true;
  card.className = `app-card last-task-card ${attention ? 'attention' : 'completed'}`;
  let icon = '•';
  let title = 'Last logical task is inactive';
  if (attention) {
    icon = '!';
    title = 'Last logical task had a failed call';
  } else if (completed) {
    icon = '✓';
    title = 'Task completion reported';
  }
  document.getElementById('lastTaskIcon').textContent = icon;
  document.getElementById('lastTaskTitle').textContent = title;
  const workspace = task.workspace || 'workspace';
  const calls = `${task.calls} tool call${task.calls === 1 ? '' : 's'}`;
  const failures = attention ? ` · ${task.failures} failed` : '';
  const completion = completed
    ? ` · ${task.summary || 'final validation passed'}`
    : ' · overall ChatGPT completion not reported';
  document.getElementById('lastTaskDetail').textContent = `${workspace} · ${calls}${failures}${completion} · ${formatDuration(task.durationMs)}`;
  renderTemporalText();
}

function renderError(view) {
  const failed = view.key === 'failed';
  document.getElementById('errorPanel').hidden = !failed;
  document.getElementById('errorMessage').textContent = currentStatus.error || 'OpenAI Secure MCP Tunnel did not become ready.';
}

function renderControls() {
  const toggle = document.getElementById('serverToggleBtn');
  toggle.textContent = currentStatus.serverRunning ? 'Stop service' : 'Start service';
  toggle.className = currentStatus.serverRunning ? 'danger compact-control' : 'primary compact-control';
  document.getElementById('dashboardBtn').disabled = !currentStatus.serverRunning;
  document.getElementById('appVersion').textContent = currentStatus.version ? `v${currentStatus.version}` : '—';
  updateNotificationButton();
}

function ensureClock() {
  const shouldRun = currentStatus.taskActivity?.state !== 'idle' || currentStatus.taskActivity?.lastTask;
  if (shouldRun && !clockTimer) clockTimer = window.setInterval(renderTemporalText, 1000);
  if (!shouldRun && clockTimer) {
    window.clearInterval(clockTimer);
    clockTimer = null;
  }
}

function renderTemporalText() {
  const activity = currentStatus.taskActivity || {};
  const elapsed = document.getElementById('taskElapsed');
  if (elapsed && activity.startedAt) elapsed.textContent = formatDuration(Date.now() - activity.startedAt);
  const task = activity.lastTask;
  const lastTime = document.getElementById('lastTaskTime');
  const endedAt = task?.endedAt || task?.completedAt;
  if (lastTime && endedAt) {
    lastTime.dateTime = new Date(endedAt).toISOString();
    lastTime.textContent = relativeTime(endedAt);
  }
}

function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function updateNotificationButton() {
  const button = document.getElementById('notificationToggleBtn');
  button.setAttribute('aria-checked', notificationsEnabled ? 'true' : 'false');
  button.setAttribute('aria-label', `Desktop notifications ${notificationsEnabled ? 'on' : 'off'}`);
  button.classList.toggle('enabled', notificationsEnabled);
  document.getElementById('notificationState').textContent = notificationsEnabled ? 'On' : 'Off';
}

async function loadNotificationPreference() {
  try {
    const result = await window.electronAPI.getNotificationsEnabled();
    notificationsEnabled = result?.enabled !== false;
    localStorage.setItem('relai_status_notifications', notificationsEnabled ? 'on' : 'off');
    updateNotificationButton();
  } catch {
    // The fallback remains usable if the preference cannot be loaded.
  }
}

async function syncNotificationPreference() {
  try {
    await window.electronAPI.setNotificationsEnabled(notificationsEnabled);
  } catch {
    // Preferences must not affect connection handling.
  }
}

function toggleNotifications() {
  notificationsEnabled = !notificationsEnabled;
  localStorage.setItem('relai_status_notifications', notificationsEnabled ? 'on' : 'off');
  updateNotificationButton();
  runAsync(syncNotificationPreference());
}

function diagnosticSummary() {
  const activity = currentStatus.taskActivity || {};
  const versionLabel = currentStatus.version ? `v${currentStatus.version}` : '';
  const serviceState = currentStatus.serverRunning ? 'running' : 'stopped';
  const taskCount = activity.activeTaskCount || activity.tasks?.length || 0;
  const lines = [
    `Rel.AI MCP ${versionLabel}`.trim(),
    `Local service: ${currentStatus.localUrl || serviceState}`,
    `Secure tunnel: ${tunnelLabel(currentStatus.tunnelStatus)}`,
    `Tunnel ID: ${currentStatus.tunnelId || 'not configured'}`,
    `Local MCP: ${currentStatus.localMcpUrl || 'unavailable'}`,
    `Task activity: ${activity.state || 'idle'} · ${taskCount} open task(s) · ${activity.activeCalls || 0} active call(s)`
  ];
  if (currentStatus.errorCode) lines.push(`Error code: ${currentStatus.errorCode}`);
  if (currentStatus.error) lines.push(`Error: ${safeDiagnosticText(currentStatus.error)}`);
  if (serviceLogs.length) lines.push('', 'Recent service logs:', ...serviceLogs.slice(-20).map(formatServiceLog));
  return safeDiagnosticText(lines.join('\n'));
}

function receiveServerLog(value) {
  const entry = normalizeServiceLog(value);
  if (!entry.message) return;
  serviceLogs.push(entry);
  if (serviceLogs.length > 100) serviceLogs.splice(0, serviceLogs.length - 100);
  renderServiceLogs();
}

function normalizeServiceLog(value) {
  if (value && typeof value === 'object') {
    return {
      ts: value.ts || new Date().toISOString(),
      level: value.level || 'info',
      source: safeDiagnosticText(value.source || 'desktop'),
      code: safeDiagnosticText(value.code || ''),
      message: safeDiagnosticText(value.message || '')
    };
  }
  return { ts: new Date().toISOString(), level: 'info', source: 'desktop', code: '', message: safeDiagnosticText(value) };
}

function renderServiceLogs() {
  const element = document.getElementById('serviceLog');
  if (!element) return;
  element.textContent = serviceLogs.length ? serviceLogs.map(formatServiceLog).join('\n') : 'No service logs recorded yet.';
  requestWindowFit();
}

function formatServiceLog(entry) {
  const code = entry.code ? ` ${entry.code}` : '';
  return `${entry.ts || ''} ${String(entry.level || 'info').toUpperCase()} ${entry.source || 'desktop'}${code}: ${entry.message}`.trim();
}

function safeDiagnosticText(value) {
  return String(value == null ? '' : value)
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:token|bootstrap|code|client_secret)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/(["']?(?:token|secret|password|authorization|api[_-]?key|authtoken|client[_-]?secret)["']?\s*:\s*)["'][^"']*["']/gi, '$1"[redacted]"')
    .replace(/\b(token|secret|password|authorization|api[_-]?key|authtoken|client[_-]?secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
}

async function copyWithFeedback(button, text, successText = 'Copied') {
  await window.electronAPI.copyUrl(text);
  const original = button.textContent;
  button.dataset.state = 'success';
  button.textContent = successText;
  window.setTimeout(() => {
    delete button.dataset.state;
    button.textContent = original;
  }, 1300);
}

function initDisclosures() {
  for (const details of document.querySelectorAll('[data-disclosure]')) {
    const key = `relai_status_disclosure_${details.dataset.disclosure}`;
    const saved = localStorage.getItem(key);
    if (saved) details.open = saved === 'open';
    details.addEventListener('toggle', () => {
      localStorage.setItem(key, details.open ? 'open' : 'closed');
      requestWindowFit();
    });
  }
}

function tunnelLabel(status) {
  if (status === 'running') return 'Connected';
  if (status === 'connecting') return 'Connecting';
  if (status === 'failed') return 'Failed';
  return 'Offline';
}

async function withBusy(button, label, action) {
  const original = button.textContent;
  button.disabled = true;
  button.dataset.state = 'loading';
  button.textContent = label;
  try {
    const result = await action();
    if (result) updateUI(result);
  } catch (error) {
    updateUI({ error: error instanceof Error ? error.message : 'The action failed.', tunnelStatus: 'failed' });
  } finally {
    button.disabled = false;
    delete button.dataset.state;
    if (button.textContent === label) button.textContent = original;
  }
}

function bindEvents() {
  document.getElementById('copyBtn').addEventListener('click', () => {
    if (currentStatus.tunnelId) runAsync(copyWithFeedback(document.getElementById('copyBtn'), currentStatus.tunnelId, 'Tunnel ID copied'));
  });
  document.getElementById('serverToggleBtn').addEventListener('click', () => {
    const button = document.getElementById('serverToggleBtn');
    const stopping = currentStatus.serverRunning;
    runAsync(withBusy(button, stopping ? 'Stopping…' : 'Starting…', () => stopping
      ? window.electronAPI.stopServer()
      : window.electronAPI.startServer()));
  });
  document.getElementById('retryBtn').addEventListener('click', () => {
    runAsync(withBusy(document.getElementById('retryBtn'), 'Retrying…', () => window.electronAPI.startServer()));
  });
  document.getElementById('notificationToggleBtn').addEventListener('click', toggleNotifications);
  document.getElementById('copyDiagnosticsBtn').addEventListener('click', () => {
    runAsync(copyWithFeedback(document.getElementById('copyDiagnosticsBtn'), diagnosticSummary(), 'Details copied'));
  });
  document.getElementById('dashboardBtn').addEventListener('click', () => {
    runAsync(withBusy(document.getElementById('dashboardBtn'), 'Opening…', async () => {
      await window.electronAPI.openDashboard();
      return null;
    }));
  });
  for (const id of ['settingsBtn', 'errorSettingsBtn']) {
    document.getElementById(id).addEventListener('click', () => runAsync(window.electronAPI.openRecoverySetup()));
  }
}

function runAsync(promise) {
  Promise.resolve(promise).catch(error => {
    if (localStorage.getItem('relai_debug') === '1') console.error(error);
  });
}

function escapeText(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

window.electronAPI.onServerStatus(updateUI);
window.electronAPI.onServerLog(receiveServerLog);
initDisclosures();
bindEvents();
updateUI(currentStatus);
runAsync(loadNotificationPreference());
