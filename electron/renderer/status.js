let currentMcpUrl = '';

function updateUI(status) {
  const serverRunning = Boolean(status && status.serverRunning);
  const tunnelStatus = status && status.tunnelStatus ? status.tunnelStatus : 'stopped';
  const mcpUrl = status && status.mcpUrl ? status.mcpUrl : '';
  const error = status && status.error ? status.error : '';
  currentMcpUrl = mcpUrl;

  const dot = document.getElementById('headerDot');
  dot.className = `status-dot${serverRunning ? ' running' : ''}`;

  const serverEl = document.getElementById('serverStatus');
  serverEl.textContent = serverRunning ? 'Running' : 'Stopped';
  serverEl.className = `card-status ${serverRunning ? 'running-text' : 'stopped-text'}`;

  const tunnelEl = document.getElementById('tunnelStatus');
  const tunnelSub = document.getElementById('tunnelSub');
  if (!serverRunning) {
    tunnelEl.textContent = 'Offline';
    tunnelEl.className = 'card-status stopped-text';
    tunnelSub.textContent = 'static domain';
  } else if (tunnelStatus === 'connecting') {
    tunnelEl.textContent = 'Connecting';
    tunnelEl.className = 'card-status connecting-text';
    tunnelSub.textContent = 'waiting for ngrok';
  } else if (tunnelStatus === 'running') {
    tunnelEl.textContent = 'Connected';
    tunnelEl.className = 'card-status running-text';
    tunnelSub.textContent = 'static domain';
  } else if (tunnelStatus === 'failed') {
    tunnelEl.textContent = 'Failed';
    tunnelEl.className = 'card-status failed-text';
    tunnelSub.textContent = error ? error.slice(0, 36) : 'server may still be local';
  } else {
    tunnelEl.textContent = 'Offline';
    tunnelEl.className = 'card-status stopped-text';
    tunnelSub.textContent = 'static domain';
  }

  const urlEl = document.getElementById('mcpUrl');
  const copyBtn = document.getElementById('copyBtn');
  if (mcpUrl) {
    urlEl.textContent = mcpUrl;
    urlEl.className = 'copy-url';
    copyBtn.disabled = false;
  } else {
    urlEl.textContent = serverRunning ? 'Waiting for tunnel...' : 'Start the server to get a URL.';
    urlEl.className = 'copy-url empty';
    copyBtn.disabled = true;
  }

  document.getElementById('errorLine').textContent = error;
  document.getElementById('stopBtn').style.display = serverRunning ? '' : 'none';
  document.getElementById('startBtn').style.display = serverRunning ? 'none' : '';
}

function bindEvents() {
  document.getElementById('copyBtn').addEventListener('click', () => {
    if (currentMcpUrl) window.electronAPI.copyUrl(currentMcpUrl);
  });
  document.getElementById('dashboardBtn').addEventListener('click', () => window.electronAPI.openDashboard());
  document.getElementById('settingsBtn').addEventListener('click', () => window.electronAPI.openSettings());
  document.getElementById('stopBtn').addEventListener('click', () => window.electronAPI.stopServer());
  document.getElementById('startBtn').addEventListener('click', () => window.electronAPI.startServer());
}

window.electronAPI.onServerStatus(updateUI);
bindEvents();
updateUI({ serverRunning: false, tunnelStatus: 'stopped', mcpUrl: '', error: '' });
