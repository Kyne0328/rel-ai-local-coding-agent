const $ = id => document.getElementById(id);
const state = {
  step: 1,
  cloudConnected: false,
  pairing: null,
  statusTimer: null,
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
  const code = String(pairing.code || '');
  $('pairingPanel').hidden = !code;
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
    ? `Legacy pairing code expires in ${Math.ceil(remaining / 60)} minutes.`
    : `Legacy pairing code expires in ${remaining} seconds.`;
  if (remaining === 0) setCloudStatus('Sign-in expired', 'Start account sign-in again to continue.');
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
    if (gateway.pairing) displayPairing(gateway.pairing);
    if (gateway.state === 'connected' && gateway.principalPaired) {
      state.cloudConnected = true;
      stopStatusPolling();
      setCloudStatus('Rel.AI account connected', 'This computer is approved and securely linked to your Rel.AI account.');
      showStep(2);
      return;
    }
    if (gateway.state === 'pairing') {
      const legacy = Boolean(gateway.pairing?.code);
      setCloudStatus(legacy ? 'Waiting for legacy approval' : 'Waiting for account approval', legacy
        ? 'Complete the legacy migration approval to adopt this existing identity into your account.'
        : 'Finish signing in and approve this computer in the browser window Rel.AI opened.');
    }
    else if (gateway.state === 'connecting' || gateway.state === 'authenticating') setCloudStatus('Connecting', 'Rel.AI is establishing the secure outbound device session.');
    else if (gateway.state === 'error') setCloudStatus('Cloud connection needs attention', gateway.error || 'Retry the connection.');
  } catch (error) {
    setError('cloudError', messageOf(error));
  }
}

async function startCloudEnrollment() {
  setError('cloudError');
  $('connectChatgptBtn').disabled = true;
  $('connectChatgptBtn').textContent = 'Opening browser…';
  try {
    const result = await window.electronAPI.startCloudEnrollment();
    displayPairing(result?.enrollment || result || {});
    setCloudStatus('Waiting for account approval', 'Finish signing in and approve this computer in the browser window Rel.AI opened.');
    startStatusPolling();
  } catch (error) {
    setError('cloudError', messageOf(error));
  } finally {
    $('connectChatgptBtn').disabled = false;
    $('connectChatgptBtn').textContent = 'Sign in or create account';
  }
}

async function cancelCloudPairing() {
  try { await window.electronAPI.cancelCloudPairing(); } catch {}
  stopStatusPolling();
  state.pairing = null;
  $('pairingPanel').hidden = true;
  $('connectChatgptBtn').hidden = false;
  $('cancelPairingBtn').hidden = true;
  setCloudStatus('Account sign-in required', 'Continue in your browser to sign in or create a Rel.AI account, then approve this computer.');
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
    displayPairing(result?.enrollment || result || {});
    setCloudStatus('Legacy identity verified', 'Finish account sign-in in the browser to adopt the existing Rel.AI identity without reconnecting ChatGPT.');
    startStatusPolling();
  } catch (error) {
    setError('recoveryError', messageOf(error));
  } finally {
    $('recoverIdentityBtn').disabled = false;
    $('recoverIdentityBtn').textContent = 'Migrate identity';
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
  if (!state.cloudConnected) return setError('securityError', 'Finish Rel.AI account sign-in before continuing.');
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

$('connectChatgptBtn').addEventListener('click', startCloudEnrollment);
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
