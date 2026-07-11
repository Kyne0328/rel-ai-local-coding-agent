let currentStatus = {
  serverRunning: false,
  tunnelStatus: 'stopped',
  mcpUrl: '',
  error: '',
  localUrl: '',
  version: '',
  taskActivity: { state: 'idle', activeCalls: 0, activeTaskCount: 0, tasks: [], workspace: '', tool: '', startedAt: null, lastTask: null }
};
let previousConnectionKey = '';
let notificationsEnabled = localStorage.getItem('relai_status_notifications') !== 'off';
let clockTimer = null;

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
  if (status.serverRunning && status.tunnelStatus === 'running' && status.mcpUrl) {
    return {
      key: 'ready', badge: 'Connected', eyebrow: 'Connected and ready',
      title: 'Rel.AI can now receive workspace tasks from ChatGPT.',
      description: 'Open the dashboard to manage repositories and review task activity. Copy the endpoint only when adding or reconnecting Rel.AI in ChatGPT.'
    };
  }
  if (status.serverRunning && status.tunnelStatus === 'connecting') {
    return {
      key: 'connecting', badge: 'Connecting', eyebrow: 'Secure connection',
      title: 'Publishing the ChatGPT endpoint…',
      description: 'The local service is running while Rel.AI prepares the secure public tunnel.'
    };
  }
  if (status.error || status.tunnelStatus === 'failed') {
    return {
      key: 'failed', badge: 'Needs attention', eyebrow: 'Connection failed',
      title: 'Rel.AI could not finish connecting.',
      description: 'Review the error below, update Settings if needed, then retry.'
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
  if (activity.state === 'settling') return settlingHero(activity, taskCount);
  return connectionView(status);
}

function workingHero(activity, taskCount) {
  const title = taskCount > 1 ? `${taskCount} ChatGPT tasks are running.` : 'ChatGPT is working.';
  return {
    key: 'working',
    badge: `${taskCount} running`,
    eyebrow: 'ChatGPT activity',
    title,
    description: activityDescription(activity, false)
  };
}

function settlingHero(activity, taskCount) {
  return {
    key: 'settling',
    badge: `${taskCount} open`,
    eyebrow: 'ChatGPT activity',
    title: `${taskCount} ${pluralize(taskCount, 'task')} waiting for follow-up calls.`,
    description: activityDescription(activity, true)
  };
}

function activityDescription(activity, settling) {
  const tasks = Array.isArray(activity.tasks) ? activity.tasks : [];
  const taskCount = Number(activity.activeTaskCount || tasks.length || 1);
  const activeCalls = Number(activity.activeCalls || 0);
  const location = activityLocation(activity, tasks);
  if (settling) return 'The task remains grouped for 60 seconds after its latest tool call. Any follow-up call renews that window.';
  if (taskCount > 1) return `${activeCalls} ${pluralize(activeCalls, 'active tool call')} across ${location}. The computer stays awake while calls are running.`;
  return `${toolLabel(activity.tool)} in ${location}. The computer stays awake until the active tool call finishes.`;
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
  if (tool === 'relai_run_checks' || tool === 'relai_browser') return 'Validating changes';
  if (tool === 'relai_diff' || tool === 'relai_git_status') return 'Reviewing changes';
  if (tool === 'relai_git_commit' || tool === 'relai_git_push' || tool === 'relai_git_create_pr') return 'Publishing changes';
  if (tool === 'relai_edit' || tool === 'relai_write' || tool === 'relai_replace' || tool === 'relai_tidy_run' || tool === 'relai_restore_changes') return 'Applying changes';
  return 'Inspecting the workspace';
}

function updateUI(status) {
  currentStatus = { ...currentStatus, ...(status || {}) };
  currentStatus.taskActivity = { ...currentStatus.taskActivity, ...(status?.taskActivity || {}) };
  const view = heroView(currentStatus);
  notifyOnConnectionChange(connectionView(currentStatus));

  const badge = document.getElementById('statusBadge');
  badge.className = `status-badge ${view.key}`;
  badge.textContent = view.badge;
  document.getElementById('statusHero').dataset.state = view.key;
  document.getElementById('statusEyebrow').textContent = view.eyebrow;
  document.getElementById('statusTitle').textContent = view.title;
  document.getElementById('statusDescription').textContent = view.description;

  renderTaskMeta();
  renderEndpoint(view);
  renderConnectionHealth();
  renderLastTask();
  renderError(view);
  renderControls();
  ensureClock();
  requestWindowFit();
}

function renderTaskMeta() {
  const activity = currentStatus.taskActivity || {};
  const element = document.getElementById('taskMeta');
  const active = activity.state === 'working' || activity.state === 'settling';
  element.hidden = !active;
  if (!active) return;
  const tasks = Array.isArray(activity.tasks) ? activity.tasks : [];
  const taskCount = Number(activity.activeTaskCount || tasks.length || 1);
  const activeCalls = Number(activity.activeCalls || 0);
  const calls = activity.state === 'working'
    ? `${activeCalls} ${pluralize(activeCalls, 'active call')}`
    : '60-second follow-up window';
  const workspace = activityLocation(activity, tasks);
  const taskLabel = `${taskCount} ${pluralize(taskCount, 'task')}`;
  element.innerHTML = `<span class="activity-pulse" aria-hidden="true"></span><strong>${escapeText(taskLabel)}</strong><span>${escapeText(workspace)}</span><span>${escapeText(calls)}</span><time id="taskElapsed"></time>`;
  renderTemporalText();
}

function renderEndpoint(view) {
  const endpoint = document.getElementById('mcpUrl');
  const copyButton = document.getElementById('copyBtn');
  const wrap = document.getElementById('endpointWrap');
  wrap.classList.toggle('compact', view.key === 'working' || view.key === 'settling');
  if (currentStatus.mcpUrl) {
    endpoint.textContent = currentStatus.mcpUrl;
    endpoint.className = 'endpoint-box';
    copyButton.disabled = false;
  } else {
    endpoint.textContent = 'Waiting for a secure endpoint…';
    if (view.key === 'stopped') endpoint.textContent = 'Start the service to create a secure endpoint.';
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
  document.getElementById('tunnelDetail').textContent = tunnelDetail(publicState, currentStatus.mcpUrl);
}

function publicHealthState(tunnelStatus) {
  if (tunnelStatus === 'running') return 'ready';
  if (tunnelStatus === 'failed') return 'failed';
  if (tunnelStatus === 'connecting') return 'connecting';
  return 'offline';
}

function tunnelDetail(publicState, mcpUrl) {
  if (mcpUrl) return 'HTTPS MCP ready';
  if (publicState === 'connecting') return 'Publishing tunnel';
  return 'Not connected';
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
  card.className = `app-card last-task-card ${attention ? 'attention' : 'completed'}`;
  document.getElementById('lastTaskIcon').textContent = attention ? '!' : '✓';
  document.getElementById('lastTaskTitle').textContent = attention ? 'Task needs attention' : 'Last task completed';
  const workspace = task.workspace || 'workspace';
  const calls = `${task.calls} tool call${task.calls === 1 ? '' : 's'}`;
  const failures = attention ? ` · ${task.failures} failed` : '';
  document.getElementById('lastTaskDetail').textContent = `${workspace} · ${calls}${failures} · ${formatDuration(task.durationMs)}`;
  renderTemporalText();
}

function renderError(view) {
  const failed = view.key === 'failed';
  document.getElementById('errorPanel').hidden = !failed;
  document.getElementById('errorMessage').textContent = currentStatus.error || 'The public tunnel did not become ready.';
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
  if (lastTime && task?.completedAt) {
    lastTime.dateTime = new Date(task.completedAt).toISOString();
    lastTime.textContent = relativeTime(task.completedAt);
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

function notifyOnConnectionChange(view) {
  const previous = previousConnectionKey;
  previousConnectionKey = view.key;
  if (!notificationsEnabled || previous === view.key) return;
  if (view.key === 'ready') showDesktopNotification('Rel.AI MCP is connected', 'The ChatGPT MCP endpoint is ready to use.');
  else if (view.key === 'failed') showDesktopNotification('Rel.AI MCP needs attention', currentStatus.error || 'The secure connection could not be established.');
}

async function showDesktopNotification(title, body) {
  if (typeof Notification !== 'function') return;
  try {
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission === 'granted') new Notification(title, { body });
  } catch {
    // Optional notifications must not affect connection handling.
  }
}

function updateNotificationButton() {
  const button = document.getElementById('notificationToggleBtn');
  button.setAttribute('aria-checked', notificationsEnabled ? 'true' : 'false');
  button.classList.toggle('enabled', notificationsEnabled);
  document.getElementById('notificationState').textContent = notificationsEnabled ? 'On' : 'Off';
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
    `Public tunnel: ${tunnelLabel(currentStatus.tunnelStatus)}`,
    `MCP endpoint: ${currentStatus.mcpUrl || 'unavailable'}`,
    `Task activity: ${activity.state || 'idle'} · ${taskCount} open task(s) · ${activity.activeCalls || 0} active call(s)`
  ];
  if (currentStatus.error) lines.push(`Error: ${currentStatus.error}`);
  return lines.join('\n');
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
    if (currentStatus.mcpUrl) runAsync(copyWithFeedback(document.getElementById('copyBtn'), currentStatus.mcpUrl, 'Endpoint copied'));
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
    document.getElementById(id).addEventListener('click', () => window.electronAPI.openSettings());
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
initDisclosures();
bindEvents();
updateUI(currentStatus);
runAsync(syncNotificationPreference());
