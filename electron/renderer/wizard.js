const $ = id => document.getElementById(id);
const recoveryMode = new URLSearchParams(location.search).get('recovery') === '1';

function setError(value = '') {
  $('setupError').textContent = String(value || '');
}

function validPort(value) {
  return Number.isInteger(value) && value >= 1024 && value <= 65535;
}

function validTunnelId(value) {
  return /^tunnel_[A-Za-z0-9_-]{8,200}$/.test(String(value || '').trim());
}

async function copySetupValue(button) {
  const value = String(button?.dataset?.copyValue || '').trim();
  if (!value) return;
  const previous = button.textContent;
  try {
    await window.electronAPI.copyText(value);
    button.textContent = 'Copied';
    setTimeout(() => {
      if (button.isConnected) button.textContent = previous;
    }, 1200);
  } catch (error) {
    setError(`Could not copy the OpenAI Platform URL: ${messageOf(error)}`);
  }
}

async function connect() {
  const tunnelId = $('tunnelIdInput').value.trim();
  const tunnelApiKey = $('tunnelApiKeyInput').value.trim();
  const port = Number($('portInput').value);
  setError();
  if (!validTunnelId(tunnelId)) return setError('Enter a valid OpenAI Secure MCP Tunnel ID beginning with tunnel_.');
  if (!validPort(port)) return setError('Local connection port must be between 1024 and 65535.');
  if (!tunnelApiKey && !$('tunnelApiKeyInput').dataset.configured) return setError('Enter the OpenAI tunnel runtime API key from Organization settings → API Keys.');

  const button = $('connectBtn');
  button.disabled = true;
  button.textContent = 'Starting secure connection…';
  try {
    const result = await window.electronAPI.wizardDone({ tunnelId, tunnelApiKey, port, restart: recoveryMode });
    if (!result?.ok || !result?.status?.serverRunning || result.status.tunnelStatus !== 'running') {
      throw new Error(result?.status?.error || 'OpenAI Secure MCP Tunnel did not become ready.');
    }
  } catch (error) {
    setError(messageOf(error));
    button.disabled = false;
    button.textContent = 'Start secure connection';
  }
}

async function loadExistingSettings() {
  try {
    const config = await window.electronAPI.getRecoveryConfig();
    if (config?.port) $('portInput').value = String(config.port);
    if (config?.tunnelId) $('tunnelIdInput').value = config.tunnelId;
    if (config?.tunnelApiKeyConfigured) {
      $('tunnelApiKeyInput').placeholder = 'Stored securely — leave blank to keep it';
      $('tunnelApiKeyInput').dataset.configured = '1';
    }
  } catch {}
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Setup failed.');
}

$('connectBtn').addEventListener('click', connect);
$('cancelWizardBtn').addEventListener('click', () => window.electronAPI.closeWizard());
document.querySelectorAll('[data-copy-value]').forEach(button => button.addEventListener('click', () => copySetupValue(button)));
void loadExistingSettings();
