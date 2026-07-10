let currentStatus = {
  serverRunning: false,
  tunnelStatus: 'stopped',
  mcpUrl: '',
  error: '',
  localUrl: '',
  version: ''
};
let stateKey = '';
let stateSince = Date.now();
let elapsedTimer = null;
let previousViewKey = '';
let notificationsEnabled = localStorage.getItem('relai_status_notifications') !== 'off';

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
      key: 'ready',
      badge: 'Connected',
      eyebrow: 'Ready for ChatGPT',
      title: 'Your workspace bridge is online.',
      description: 'Copy the endpoint below when creating or updating the Rel.AI MCP app in ChatGPT.'
    };
  }
  if (status.serverRunning && status.tunnelStatus === 'connecting') {
    return {
      key: 'connecting',
      badge: 'Connecting',
      eyebrow: 'Secure tunnel',
      title: 'Publishing the ChatGPT endpoint…',
      description: 'The local service is running and waiting for tunnel publication over HTTPS.'
    };
  }
  if (status.error || status.tunnelStatus === 'failed') {
    return {
      key: 'failed',
      badge: 'Needs attention',
      eyebrow: 'Connection failed',
      title: 'Rel.AI could not finish connecting.',
      description: 'Review the error below, update Settings if needed, then retry the connection.'
    };
  }
  return {
    key: 'stopped',
    badge: 'Stopped',
    eyebrow: 'Service stopped',
    title: 'Rel.AI is not running.',
    description: 'Start the service to make your local workspaces available to ChatGPT.'
  };
}

function updateStateClock(key) {
  if (key !== stateKey) {
    stateKey = key;
    stateSince = Date.now();
  }
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = key === 'connecting' ? setInterval(renderElapsed, 1000) : null;
}

function renderElapsed() {
  if (stateKey !== 'connecting') return;
  const seconds = Math.max(1, Math.floor((Date.now() - stateSince) / 1000));
  const description = document.getElementById('statusDescription');
  description.textContent = `The local service is running and waiting for tunnel publication for ${seconds} second${seconds === 1 ? '' : 's'}.`;
}

function updateUI(status) {
  currentStatus = { ...currentStatus, ...(status || {}) };
  const view = connectionView(currentStatus);
  updateStateClock(view.key);
  notifyOnStateChange(view);

  const badge = document.getElementById('statusBadge');
  badge.className = `status-badge ${view.key}`;
  badge.textContent = view.badge;
  document.getElementById('statusEyebrow').textContent = view.eyebrow;
  document.getElementById('statusTitle').textContent = view.title;
  document.getElementById('statusDescription').textContent = view.description;

  const endpoint = document.getElementById('mcpUrl');
  const copyButton = document.getElementById('copyBtn');
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

  const toggle = document.getElementById('serverToggleBtn');
  toggle.textContent = currentStatus.serverRunning ? 'Stop service' : 'Start service';
  toggle.className = currentStatus.serverRunning ? 'danger' : 'primary';

  const failed = view.key === 'failed';
  document.getElementById('errorPanel').hidden = !failed;
  document.getElementById('errorMessage').textContent = currentStatus.error || 'The public tunnel did not become ready.';
  document.getElementById('retryBtn').hidden = !failed;

  document.getElementById('localService').textContent = currentStatus.localUrl || (currentStatus.serverRunning ? 'Running locally' : 'Not running');
  document.getElementById('tunnelDetail').textContent = tunnelLabel(currentStatus.tunnelStatus);
  document.getElementById('appVersion').textContent = currentStatus.version ? `v${currentStatus.version}` : '—';
  updateNotificationButton();
  requestWindowFit();
}

function notifyOnStateChange(view) {
  const previous = previousViewKey;
  previousViewKey = view.key;
  if (!notificationsEnabled || previous === view.key) return;
  if (view.key === 'ready') {
    showDesktopNotification('Rel.AI MCP is connected', 'The ChatGPT MCP endpoint is ready to use.');
  } else if (view.key === 'failed') {
    showDesktopNotification('Rel.AI MCP needs attention', currentStatus.error || 'The secure connection could not be established.');
  }
}

async function showDesktopNotification(title, body) {
  if (typeof Notification !== 'function') return;
  try {
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission === 'granted') new Notification(title, { body });
  } catch {
    // Notifications are optional and must never affect connection handling.
  }
}

function updateNotificationButton() {
  const button = document.getElementById('notificationToggleBtn');
  if (!button) return;
  button.textContent = notificationsEnabled ? 'On' : 'Off';
  button.setAttribute('aria-pressed', notificationsEnabled ? 'true' : 'false');
}

function toggleNotifications() {
  notificationsEnabled = !notificationsEnabled;
  localStorage.setItem('relai_status_notifications', notificationsEnabled ? 'on' : 'off');
  updateNotificationButton();
}

function diagnosticSummary() {
  return [
    `Rel.AI MCP ${currentStatus.version ? `v${currentStatus.version}` : ''}`.trim(),
    `Local service: ${currentStatus.localUrl || (currentStatus.serverRunning ? 'running' : 'stopped')}`,
    `Public tunnel: ${tunnelLabel(currentStatus.tunnelStatus)}`,
    `MCP endpoint: ${currentStatus.mcpUrl || 'unavailable'}`,
    `Status: ${connectionView(currentStatus).badge}`,
    ...(currentStatus.error ? [`Error: ${currentStatus.error}`] : [])
  ].join('\n');
}

async function copyDiagnostics() {
  const button = document.getElementById('copyDiagnosticsBtn');
  await window.electronAPI.copyUrl(diagnosticSummary());
  const original = button.textContent;
  button.dataset.state = 'success';
  button.textContent = 'Copied';
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
  document.getElementById('copyBtn').addEventListener('click', async () => {
    if (!currentStatus.mcpUrl) return;
    const button = document.getElementById('copyBtn');
    await window.electronAPI.copyUrl(currentStatus.mcpUrl);
    const original = button.textContent;
    button.textContent = 'Copied';
    window.setTimeout(() => { button.textContent = original; }, 1400);
  });

  document.getElementById('serverToggleBtn').addEventListener('click', () => {
    const button = document.getElementById('serverToggleBtn');
    const stopping = currentStatus.serverRunning;
    withBusy(button, stopping ? 'Stopping…' : 'Starting…', () => stopping
      ? window.electronAPI.stopServer()
      : window.electronAPI.startServer());
  });

  document.getElementById('retryBtn').addEventListener('click', () => {
    const button = document.getElementById('retryBtn');
    withBusy(button, 'Retrying…', () => window.electronAPI.startServer());
  });
  document.getElementById('notificationToggleBtn').addEventListener('click', toggleNotifications);
  document.getElementById('copyDiagnosticsBtn').addEventListener('click', copyDiagnostics);
  document.getElementById('dashboardBtn').addEventListener('click', () => window.electronAPI.openDashboard());
  document.getElementById('settingsBtn').addEventListener('click', () => window.electronAPI.openSettings());
}

window.electronAPI.onServerStatus(updateUI);
initDisclosures();
bindEvents();
updateUI(currentStatus);
