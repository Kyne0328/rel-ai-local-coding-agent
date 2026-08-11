const $ = id => document.getElementById(id);
const state = {
  step: 1,
  cloudConnected: false,
  pairing: null,
  statusTimer: null,
  recoveryCode: '',
  direct: { port: 3333, ngrokAuthtoken: '', ngrokDomain: '' }
};

const steps = [...document.querySelectorAll('[data-step]')];
const progressItems = [...document.querySelectorAll('[data-progress]')];
const recoveryMode = new URLSearchParams(location.search).get('recovery') === '1';

function showStep(step) {
  state.step = Math.min(3, Math.max(1, Number(step) || 1));
  steps.forEach(section => { section.hidden = Number(section.dataset.step) !== state.step; });
  progressItems.forEach(item => {
    const number = Number(item.dataset.progress);
    item.classList.toggle('active', number === state.step);
    item.classList.toggle('done', number < state.step);
  });
  window.electronAPI.fitWindow?.('wizard').catch(() => {});
}

function setError(id, value = '') {
  $(id).textContent = String(value || '');
}

function setCloudStatus(title, detail) {
  $('cloudStatus').innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = detail;
  $('cloudStatus').append(strong, span);
}

function displayPairing(pairing = {}) {
  state.pairing = pairing;
  $('pairingPanel').hidden = false;
  const code = String(pairing.code || '');
  $('pairingCode').textContent = code || '—';
  $('copyPairingBtn').disabled = !code;
  updatePairingExpiry();
  $('connectChatgptBtn').hidden = true;
  $('cancelPairingBtn').hidden = false;
}

function updatePairingExpiry() {
  if (!state.pairing) return;
  const expiresAt = Number(state.pairing.expiresAt || 0);
  if (!expiresAt) {
    $('pairingExpiry').textContent = 'This pairing code expires shortly.';
    return;
  }
  const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  $('pairingExpiry').textContent = remaining > 60
    ? `Pairing code expires in ${Math.ceil(remaining / 60)} minutes.`
    : `Pairing code expires in ${remaining} seconds.`;
  if (remaining === 0) setCloudStatus('Pairing code expired', 'Create a new short-lived code to continue.');
}

function startStatusPolling() {
  stopStatusPolling();
  state.statusTimer = setInterval(() => { void refreshCloudStatus(); }, 1200);
}

function stopStatusPolling() {
  if (state.statusTimer) clearInterval(state.statusTimer);
  state.statusTimer = null;
}

async function refreshCloudStatus() {
  updatePairingExpiry();
  try {
    const response = await window.electronAPI.getCloudSetupStatus();
    const gateway = response?.gateway || {};
    if (gateway.pairing?.code) displayPairing(gateway.pairing);
    if (gateway.state === 'connected' && gateway.principalPaired) {
      state.cloudConnected = true;
      stopStatusPolling();
      setCloudStatus('ChatGPT paired', 'This device is authenticated with Rel.AI Cloud.');
      showStep(2);
      return;
    }
    if (gateway.state === 'pairing') setCloudStatus('Waiting for ChatGPT approval', 'Plus or Pro: open Plugins in ChatGPT (sidebar or Settings → Plugins), add Rel.AI MCP, and connect it. Business, Enterprise, or Edu: open Rel.AI under workspace Apps. Then enter this code on the Rel.AI authorization page.');
    else if (gateway.state === 'connecting' || gateway.state === 'authenticating') setCloudStatus('Connecting', 'Rel.AI is establishing the secure outbound device session.');
    else if (gateway.state === 'error') setCloudStatus('Cloud connection needs attention', gateway.error || 'Retry the connection.');
  } catch (error) {
    setError('cloudError', messageOf(error));
  }
}

async function startCloudPairing() {
  setError('cloudError');
  $('connectChatgptBtn').disabled = true;
  $('connectChatgptBtn').textContent = 'Creating code…';
  try {
    const result = await window.electronAPI.startCloudPairing();
    displayPairing(result?.pairing || result || {});
    setCloudStatus('Waiting for ChatGPT approval', 'Plus or Pro: open Plugins in ChatGPT (sidebar or Settings → Plugins), add Rel.AI MCP, and connect it. Business, Enterprise, or Edu: open Rel.AI under workspace Apps. Then enter this code on the Rel.AI authorization page.');
    startStatusPolling();
  } catch (error) {
    setError('cloudError', messageOf(error));
  } finally {
    $('connectChatgptBtn').disabled = false;
    $('connectChatgptBtn').textContent = 'Create pairing code';
  }
}

async function cancelCloudPairing() {
  try { await window.electronAPI.cancelCloudPairing(); } catch {}
  stopStatusPolling();
  state.pairing = null;
  $('pairingPanel').hidden = true;
  $('connectChatgptBtn').hidden = false;
  $('cancelPairingBtn').hidden = true;
  setCloudStatus('Not connected yet', 'Create a short-lived pairing code to continue.');
}

async function showRecovery() {
  setError('securityError');
  $('showRecoveryBtn').disabled = true;
  try {
    const result = await window.electronAPI.getWizardRecoveryCode();
    const recoveryCode = String(result?.recoveryCode || '');
    if (!recoveryCode) throw new Error('No recovery code is available yet.');
    state.recoveryCode = recoveryCode;
    $('recoveryCodeValue').textContent = recoveryCode;
    $('recoveryOutput').hidden = false;
  } catch (error) {
    setError('securityError', messageOf(error));
  } finally {
    $('showRecoveryBtn').disabled = false;
  }
}

async function recoverCloudIdentity() {
  const recoveryCode = $('recoveryCodeInput').value.trim();
  setError('recoveryError');
  if (!recoveryCode) {
    setError('recoveryError', 'Enter the Rel.AI recovery code from your existing device.');
    return;
  }
  $('recoverIdentityBtn').disabled = true;
  $('recoverIdentityBtn').textContent = 'Verifying…';
  try {
    const result = await window.electronAPI.recoverCloudIdentity(recoveryCode);
    $('advancedSetup').open = false;
    showStep(1);
    displayPairing(result?.pairing || result || {});
    setCloudStatus('Recovery verified', 'Approve this short-lived pairing code in ChatGPT to finish linking the replacement device.');
    startStatusPolling();
  } catch (error) {
    setError('recoveryError', messageOf(error));
  } finally {
    $('recoverIdentityBtn').disabled = false;
    $('recoverIdentityBtn').textContent = 'Recover identity';
  }
}

async function createDeviceLink() {
  setError('recoveryError');
  $('createLinkCodeBtn').disabled = true;
  $('createLinkCodeBtn').textContent = 'Creating…';
  try {
    const result = await window.electronAPI.createWizardDeviceLink();
    const linkCode = String(result?.linkCode || '');
    if (!linkCode) throw new Error('No link code was returned.');
    $('linkCodeValue').textContent = linkCode;
    $('linkCodeOutput').hidden = false;
    const expiresAt = Number(result.expiresAt || 0);
    $('linkCodeExpiry').textContent = expiresAt ? `One-time code expires ${new Date(expiresAt).toLocaleString()}.` : 'This one-time code expires shortly.';
  } catch (error) {
    setError('recoveryError', messageOf(error));
  } finally {
    $('createLinkCodeBtn').disabled = false;
    $('createLinkCodeBtn').textContent = 'Create one-time link code';
  }
}

async function launchDirect() {
  const port = Number($('directPortInput').value);
  const ngrokAuthtoken = $('directNgrokTokenInput').value.trim();
  const ngrokDomain = $('directDomainInput').value.trim();
  setError('directError');
  if (!isValidPort(port)) return setError('directError', 'Port must be between 1024 and 65535.');
  if (!isValidNgrokKey(ngrokAuthtoken)) return setError('directError', 'Enter a valid ngrok account key.');
  if (!isValidDomain(ngrokDomain)) return setError('directError', 'Enter a valid static ngrok domain.');
  $('launchDirectBtn').disabled = true;
  $('launchDirectBtn').textContent = 'Starting Direct connection…';
  try {
    const result = await window.electronAPI.wizardDone({
      connectionMode: 'direct',
      port,
      ngrokAuthtoken,
      ngrokDomain,
      restart: true
    });
    if (!result?.ok || !result?.status?.serverRunning) throw new Error(result?.status?.error || 'Direct connection did not start.');
  } catch (error) {
    setError('directError', messageOf(error));
    $('launchDirectBtn').disabled = false;
    $('launchDirectBtn').textContent = 'Use Direct connection';
  }
}

async function finishCloud() {
  if (!state.cloudConnected) return setError('securityError', 'Finish ChatGPT pairing before continuing.');
  $('finishCloudBtn').disabled = true;
  try {
    const result = await window.electronAPI.wizardDone({ connectionMode: 'cloud', restart: false });
    if (!result?.ok || !result?.status?.serverRunning) throw new Error(result?.status?.error || 'Rel.AI Cloud did not finish setup.');
  } catch (error) {
    setError('securityError', messageOf(error));
    $('finishCloudBtn').disabled = false;
  }
}

function isValidPort(value) {
  return Number.isInteger(value) && value >= 1024 && value <= 65535;
}

function isValidNgrokKey(value) {
  const text = String(value || '').trim();
  return text.length >= 8 && text.length <= 2048 && !/\s/.test(text);
}

function isValidDomain(value) {
  const text = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  return text.length >= 3 && text.length <= 253 && text.includes('.') && /^[a-z0-9.-]+$/.test(text) && !text.includes('..') && text.split('.').every(label => label && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Setup failed.');
}

async function loadExistingSettings() {
  try {
    const config = await window.electronAPI.getRecoveryConfig();
    if (config?.port) $('directPortInput').value = String(config.port);
    if (config?.ngrokAuthtoken) $('directNgrokTokenInput').value = config.ngrokAuthtoken;
    if (config?.ngrokDomain) $('directDomainInput').value = config.ngrokDomain;
    if (recoveryMode && config?.connectionMode === 'direct') $('advancedSetup').open = true;
  } catch {}
}

$('connectChatgptBtn').addEventListener('click', startCloudPairing);
$('cancelPairingBtn').addEventListener('click', cancelCloudPairing);
$('copyPairingBtn').addEventListener('click', async () => {
  const code = String(state.pairing?.code || '');
  if (!code) return;
  const button = $('copyPairingBtn');
  const label = $('pairingCopyLabel');
  button.disabled = true;
  label.textContent = 'Copying…';
  try {
    await window.electronAPI.copyText(code);
    label.textContent = 'Copied';
  } catch (error) {
    label.textContent = 'Copy code';
    setError('cloudError', messageOf(error));
  } finally {
    button.disabled = false;
    setTimeout(() => { label.textContent = 'Copy code'; }, 1200);
  }
});
$('showRecoveryBtn').addEventListener('click', showRecovery);
$('copyRecoveryBtn').addEventListener('click', async () => {
  if (!state.recoveryCode) return;
  await window.electronAPI.copyText(state.recoveryCode);
  $('copyRecoveryBtn').textContent = 'Copied';
  setTimeout(() => { $('copyRecoveryBtn').textContent = 'Copy'; }, 1200);
});
$('continueSecurityBtn').addEventListener('click', () => showStep(3));
$('backToPairingBtn').addEventListener('click', () => showStep(1));
$('backToSecurityBtn').addEventListener('click', () => showStep(2));
$('finishCloudBtn').addEventListener('click', finishCloud);
$('recoverIdentityBtn').addEventListener('click', recoverCloudIdentity);
$('createLinkCodeBtn').addEventListener('click', createDeviceLink);
$('copyLinkCodeBtn').addEventListener('click', async () => {
  const value = $('linkCodeValue').textContent;
  if (!value) return;
  await window.electronAPI.copyText(value);
  $('copyLinkCodeBtn').textContent = 'Copied';
  setTimeout(() => { $('copyLinkCodeBtn').textContent = 'Copy'; }, 1200);
});
$('launchDirectBtn').addEventListener('click', launchDirect);
$('cancelWizardBtn').addEventListener('click', async () => { stopStatusPolling(); await window.electronAPI.closeWizard(); });

document.querySelectorAll('[data-external-url]').forEach(button => button.addEventListener('click', () => window.electronAPI.openExternal(button.dataset.externalUrl)));
window.addEventListener('beforeunload', stopStatusPolling);

void loadExistingSettings();
showStep(1);
