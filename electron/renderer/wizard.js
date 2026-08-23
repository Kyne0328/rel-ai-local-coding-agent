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

function validRuntimeKey(value) {
  const key = String(value || '').trim();
  return key.length >= 12 && !/\s/.test(key);
}

function validConnectorName(value) {
  const name = String(value || '').trim();
  return name.length >= 3 && name.length <= 80 && !/[\r\n\0]/.test(name);
}

function clearFieldError(inputId, errorId) {
  const input = $(inputId);
  const error = $(errorId);
  input?.setAttribute('aria-invalid', 'false');
  if (error) {
    error.textContent = '';
    error.hidden = true;
  }
}

function setFieldError(inputId, errorId, message) {
  const input = $(inputId);
  const error = $(errorId);
  input?.setAttribute('aria-invalid', 'true');
  if (error) {
    error.textContent = message;
    error.hidden = false;
  }
  input?.focus();
}

function clearValidationErrors() {
  clearFieldError('connectorNameInput', 'connectorNameError');
  clearFieldError('tunnelIdInput', 'tunnelIdError');
  clearFieldError('tunnelApiKeyInput', 'runtimeKeyError');
  clearFieldError('portInput', 'portError');
}

async function openOpenAISetup(button) {
  const destination = String(button?.dataset?.openOpenai || '');
  if (!destination) return;
  setError();
  try {
    await window.electronAPI.openOpenAISetup(destination);
  } catch (error) {
    setError(`Could not open OpenAI setup: ${messageOf(error)}`);
  }
}

async function connect() {
  const connectorName = $('connectorNameInput').value.trim();
  const tunnelId = $('tunnelIdInput').value.trim();
  const tunnelApiKey = $('tunnelApiKeyInput').value.trim();
  const runtimeKeyConfigured = $('tunnelApiKeyInput').dataset.configured === '1';
  const port = Number($('portInput').value);
  setError();
  clearValidationErrors();
  if (!validConnectorName(connectorName)) {
    setFieldError('connectorNameInput', 'connectorNameError', 'Enter a connector name from 3 to 80 characters.');
    return;
  }
  if (!validTunnelId(tunnelId)) {
    setFieldError('tunnelIdInput', 'tunnelIdError', 'Paste a valid Secure MCP Tunnel ID beginning with tunnel_.');
    return;
  }
  if (!tunnelApiKey && !runtimeKeyConfigured) {
    setFieldError('tunnelApiKeyInput', 'runtimeKeyError', 'Paste the API key you created for this tunnel in the same OpenAI organization.');
    return;
  }
  if (tunnelApiKey && !validRuntimeKey(tunnelApiKey)) {
    setFieldError('tunnelApiKeyInput', 'runtimeKeyError', 'Paste a valid runtime API key with no spaces.');
    return;
  }
  if (!validPort(port)) {
    setFieldError('portInput', 'portError', 'Enter a local connection port from 1024 to 65535.');
    return;
  }

  const button = $('connectBtn');
  button.disabled = true;
  button.textContent = 'Connecting…';
  try {
    const result = await window.electronAPI.wizardDone({ connectorName, tunnelId, tunnelApiKey, port, restart: recoveryMode });
    if (!result?.ok || !result?.status?.serverRunning || result.status.tunnelStatus !== 'running') {
      throw new Error(result?.status?.error || 'The ChatGPT connection did not become ready.');
    }
  } catch (error) {
    setError(messageOf(error));
    button.disabled = false;
    button.textContent = 'Connect to ChatGPT';
  }
}

async function loadExistingSettings() {
  try {
    const config = await window.electronAPI.getRecoveryConfig();
    if (config?.connectorName) $('connectorNameInput').value = config.connectorName;
    if (config?.port) $('portInput').value = String(config.port);
    if (config?.tunnelId) $('tunnelIdInput').value = config.tunnelId;
    if (config?.tunnelApiKeyConfigured) {
      $('tunnelApiKeyInput').placeholder = 'Stored securely — leave blank to keep it';
      $('tunnelApiKeyInput').dataset.configured = '1';
      $('tunnelApiKeyInput').required = false;
    }
  } catch {}
}

if (recoveryMode) $('supportProjectCard')?.remove();

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Setup failed.');
}

$('connectBtn').addEventListener('click', connect);
$('runtimeKeyToggle').addEventListener('click', () => {
  const input = $('tunnelApiKeyInput');
  const button = $('runtimeKeyToggle');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  button.textContent = showing ? 'Show' : 'Hide';
  button.setAttribute('aria-pressed', String(!showing));
  input.focus();
});
$('cancelWizardBtn').addEventListener('click', () => window.electronAPI.closeWizard());
document.querySelectorAll('[data-open-openai]').forEach(button => button.addEventListener('click', () => openOpenAISetup(button)));
for (const [inputId, errorId] of [['connectorNameInput', 'connectorNameError'], ['tunnelIdInput', 'tunnelIdError'], ['tunnelApiKeyInput', 'runtimeKeyError'], ['portInput', 'portError']]) {
  $(inputId).addEventListener('input', () => clearFieldError(inputId, errorId));
}
void loadExistingSettings();
