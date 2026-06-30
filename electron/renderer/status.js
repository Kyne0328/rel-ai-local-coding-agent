let currentMcpUrl = '';

function requestWindowFit() {
  window.requestAnimationFrame(() => {
    if (!window.electronAPI || typeof window.electronAPI.fitWindowToContent !== 'function') return;
    const body = document.querySelector('.body');
    const widthSource = body || document.documentElement;
    const width = Math.ceil(widthSource.getBoundingClientRect().width);
    const height = Math.ceil(document.documentElement.scrollHeight);
    window.electronAPI.fitWindowToContent({ width, height });
  });
}

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

  const serverCardEl = document.getElementById('serverCardStatus');
  serverCardEl.textContent = serverRunning ? 'Running' : 'Stopped';
  serverCardEl.className = `card-status ${serverRunning ? 'running-text' : 'stopped-text'}`;

  const tunnelEl = document.getElementById('tunnelStatus');
  const tunnelSub = document.getElementById('tunnelSub');
  if (!serverRunning) {
    tunnelEl.textContent = 'Offline';
    tunnelEl.className = 'card-status stopped-text';
    tunnelSub.textContent = 'waiting for domain';
  } else if (tunnelStatus === 'connecting') {
    tunnelEl.textContent = 'Connecting';
    tunnelEl.className = 'card-status connecting-text';
    tunnelSub.textContent = 'waiting for tunnel';
  } else if (tunnelStatus === 'running') {
    tunnelEl.textContent = 'Connected';
    tunnelEl.className = 'card-status running-text';
    tunnelSub.textContent = 'ready for ChatGPT';
  } else if (tunnelStatus === 'failed') {
    tunnelEl.textContent = 'Failed';
    tunnelEl.className = 'card-status failed-text';
    tunnelSub.textContent = error ? error.slice(0, 36) : 'HTTPS tunnel required';
  } else {
    tunnelEl.textContent = 'Offline';
    tunnelEl.className = 'card-status stopped-text';
    tunnelSub.textContent = 'waiting for domain';
  }

  const urlEl = document.getElementById('mcpUrl');
  const copyBtn = document.getElementById('copyBtn');
  if (mcpUrl) {
    urlEl.textContent = mcpUrl;
    urlEl.className = 'copy-url';
    copyBtn.disabled = false;
  } else {
    urlEl.textContent = serverRunning ? 'Waiting for the HTTPS tunnel to publish the MCP URL...' : 'Start the server to create an HTTPS ChatGPT MCP URL.';
    urlEl.className = 'copy-url empty';
    copyBtn.disabled = true;
  }

  document.getElementById('errorLine').textContent = error;
  document.getElementById('stopBtn').style.display = serverRunning ? '' : 'none';
  document.getElementById('startBtn').style.display = serverRunning ? 'none' : '';
  requestWindowFit();
}

function bindEvents() {
  document.getElementById('copyBtn').addEventListener('click', () => {
    if (!currentMcpUrl) return;
    window.electronAPI.copyUrl(currentMcpUrl);
    const btn = document.getElementById('copyBtn');
    const original = btn.textContent;
    btn.textContent = 'Copied MCP URL';
    window.setTimeout(() => { btn.textContent = original; }, 1600);
  });
  document.getElementById('dashboardBtn').addEventListener('click', () => window.electronAPI.openDashboard());
  document.getElementById('settingsBtn').addEventListener('click', () => window.electronAPI.openSettings());
  document.getElementById('stopBtn').addEventListener('click', () => window.electronAPI.stopServer());
  document.getElementById('startBtn').addEventListener('click', () => window.electronAPI.startServer());
}

window.electronAPI.onServerStatus(updateUI);
bindEvents();
updateUI({ serverRunning: false, tunnelStatus: 'stopped', mcpUrl: '', error: '' });
