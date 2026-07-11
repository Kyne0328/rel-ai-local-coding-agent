let currentStatus = {
  serverRunning: false,
  tunnelStatus: 'stopped',
  mcpUrl: '',
  error: '',
  localUrl: '',
  version: '',
  taskActivity: { state: 'idle', activeCalls: 0, workspace: '', tool: '', startedAt: null, lastTask: null }
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
      key: 'ready', badge: 'Connected', eyebrow: 'Ready for ChatGPT',
      title: 'Your workspace bridge is online.',
      description: 'Open the dashboard to manage workspaces or copy the MCP endpoint for ChatGPT.'
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
  if (activity.state === 'working') {
    return {
      key: 'working', badge: 'Working', eyebrow: 'ChatGPT activity',
      title: 'ChatGPT is working.',
      description: activityDescription(activity, false)
    };
  }
  if (activity.state === 'settling') {
    return {
      key: 'settling', badge: 'Wrapping up', eyebrow: 'ChatGPT activity',
      title: 'Wrapping up the task…',
      description: activityDescription(activity, true)
    };
  }
  return connectionView(status);
}

function activityDescription(activity, settling) {
  const action = toolLabel(activity.tool);
  const workspace = activity.workspace || 'configured workspace';
  return settling
    ? `Waiting briefly for any final ChatGPT actions in ${workspace}.`
    : `${action} in ${workspace}. The computer will stay awake until active tool calls finish.`;
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
  const calls = activity.activeCalls > 1 ? `${activity.activeCalls} concurrent calls` : activity.state === 'working' ? '1 active call' : 'Waiting for final calls';
  const workspace = activity.workspace || 'Workspace';
  element.innerHTML = `<span class="activity-pulse" aria-hidden="true"></span><strong>${escapeText(workspace)}</strong><span>${escapeText(toolLabel(activity.tool))}</span><span>${escapeText(calls)}</span><time id="taskElapsed"></time>`;
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
    endpoint.textContent = view.key === 'stopped'
      ? 'Start the service to create a secure endpoint.'
      : 'Waiting for a secure endpoint…';
    endpoint.className = 'endpoint-box empty';
    copyButton.disabled = true;
  }
}

function renderConnectionHealth() {
  setHealthCard('localHealthCard', currentStatus.serverRunning ? 'ready' : 'offline');
  document.getElementById('localHealthState').textContent = currentStatus.serverRunning ? 'Running' : 'Stopped';
  document.getElementById('localService').textContent = currentStatus.localUrl || (currentStatus.serverRunning ? 'Running locally' : 'Not running');

  const publicState = currentStatus.tunnelStatus === 'running'
    ? 'ready'
    : currentStatus.tunnelStatus === 'failed'
      ? 'failed'
      : currentStatus.tunnelStatus === 'connecting'
        ? 'connecting'
        : 'offline';
  setHealthCard('publicHealthCard', publicState);
  document.getElementById('publicHealthState').textContent = tunnelLabel(currentStatus.tunnelStatus);
  document.getElementById('tunnelDetail').textContent = currentStatus.mcpUrl ? 'HTTPS MCP ready' : publicState === 'connecting' ? 'Publishing tunnel' : 'Not connected';
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
  void syncNotificationPreference();
}

function diagnosticSummary() {
  const activity = currentStatus.taskActivity || {};
  return [
    `Rel.AI MCP ${currentStatus.version ? `v${currentStatus.version}` : ''}`.trim(),
    `Local service: ${currentStatus.localUrl || (currentStatus.serverRunning ? 'running' : 'stopped')}`,
    `Public tunnel: ${tunnelLabel(currentStatus.tunnelStatus)}`,
    `MCP endpoint: ${currentStatus.mcpUrl || 'unavailable'}`,
    `Task activity: ${activity.state || 'idle'}${activity.workspace ? ` in ${activity.workspace}` : ''}`,
    ...(currentStatus.error ? [`Error: ${currentStatus.error}`] : [])
  ].join('\n');
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
    if (currentStatus.mcpUrl) void copyWithFeedback(document.getElementById('copyBtn'), currentStatus.mcpUrl, 'Endpoint copied');
  });
  document.getElementById('serverToggleBtn').addEventListener('click', () => {
    const button = document.getElementById('serverToggleBtn');
    const stopping = currentStatus.serverRunning;
    void withBusy(button, stopping ? 'Stopping…' : 'Starting…', () => stopping
      ? window.electronAPI.stopServer()
      : window.electronAPI.startServer());
  });
  document.getElementById('retryBtn').addEventListener('click', () => {
    void withBusy(document.getElementById('retryBtn'), 'Retrying…', () => window.electronAPI.startServer());
  });
  document.getElementById('notificationToggleBtn').addEventListener('click', toggleNotifications);
  document.getElementById('copyDiagnosticsBtn').addEventListener('click', () => {
    void copyWithFeedback(document.getElementById('copyDiagnosticsBtn'), diagnosticSummary(), 'Details copied');
  });
  document.getElementById('dashboardBtn').addEventListener('click', () => window.electronAPI.openDashboard());
  for (const id of ['settingsBtn', 'errorSettingsBtn']) {
    document.getElementById(id).addEventListener('click', () => window.electronAPI.openSettings());
  }
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
void syncNotificationPreference();
