const state = {
  port: 3333,
  token: '',
  ngrokDomain: '',
  editMode: false
};

let currentStep = 1;

function normalizeDomain(value) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
}

function isValidDomain(domain) {
  if (!domain || domain.length > 253 || !domain.includes('.')) return false;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(domain)) return false;
  if (domain.includes('..')) return false;
  return domain.split('.').every((label) => label && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}

function goTo(stepNumber) {
  const current = document.getElementById(`step${currentStep}`);
  if (current) current.classList.remove('active');
  currentStep = stepNumber;
  document.getElementById(`step${stepNumber}`).classList.add('active');
  updateProgress();
  if (stepNumber === 3 && !state.token) regenerateToken();
  if (stepNumber === 4) updateNgrokPreview();
  if (stepNumber === 5) renderSummary();
}

function updateProgress() {
  for (let i = 1; i <= 5; i += 1) {
    document.getElementById(`p${i}`).classList.toggle('done', i <= currentStep);
  }
}

function validatePort() {
  const value = Number.parseInt(document.getElementById('portInput').value, 10);
  const hint = document.getElementById('portHint');
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    hint.textContent = 'Enter a valid port between 1024 and 65535.';
    hint.style.color = '#f87171';
    return;
  }
  state.port = value;
  hint.textContent = 'Port saved.';
  hint.style.color = '#22c55e';
  window.setTimeout(() => goTo(3), 200);
}

function regenerateToken() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  state.token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  document.getElementById('tokenBox').textContent = state.token;
}

function copyToken() {
  if (state.token) window.electronAPI.copyUrl(state.token);
}

function updateNgrokPreview() {
  const domain = normalizeDomain(document.getElementById('domainInput').value);
  document.getElementById('ngrokCmdPreview').textContent = `ngrok http --url=${domain || '<domain>'} http://127.0.0.1:${state.port} --log=stdout`;
}

function validateDomain() {
  const domain = normalizeDomain(document.getElementById('domainInput').value);
  const error = document.getElementById('domainError');
  if (!isValidDomain(domain)) {
    error.textContent = 'Enter a valid domain, for example your-name.ngrok-free.dev.';
    return;
  }
  state.ngrokDomain = domain;
  error.textContent = '';
  goTo(5);
}

function renderSummary() {
  const box = document.getElementById('summaryBox');
  box.innerHTML = '';
  const rows = [
    ['Port', String(state.port)],
    ['Dashboard token', 'saved to ~/.rel-ai-mcp/.env'],
    ['ngrok domain', state.ngrokDomain]
  ];
  for (const [key, value] of rows) {
    const row = document.createElement('div');
    row.className = 'summary-row';
    const keyEl = document.createElement('span');
    keyEl.className = 'summary-key';
    keyEl.textContent = key;
    const valEl = document.createElement('span');
    valEl.className = 'summary-val';
    valEl.textContent = value;
    row.append(keyEl, valEl);
    box.append(row);
  }
}

async function launch() {
  const launchError = document.getElementById('launchError');
  launchError.textContent = '';
  try {
    await window.electronAPI.wizardDone({
      port: state.port,
      token: state.token,
      ngrokDomain: state.ngrokDomain
    });
  } catch (error) {
    launchError.textContent = error && error.message ? error.message : String(error);
  }
}

function loadEditParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('edit') !== '1') return;
  state.editMode = true;
  state.port = Number.parseInt(params.get('port') || '3333', 10) || 3333;
  state.token = params.get('token') || '';
  state.ngrokDomain = normalizeDomain(params.get('domain') || '');
  document.getElementById('portInput').value = state.port;
  document.getElementById('domainInput').value = state.ngrokDomain;
  document.getElementById('tokenBox').textContent = state.token;
}

function bindEvents() {
  document.getElementById('startWizardBtn').addEventListener('click', () => goTo(2));
  document.getElementById('validatePortBtn').addEventListener('click', validatePort);
  document.getElementById('copyTokenBtn').addEventListener('click', copyToken);
  document.getElementById('regenTokenBtn').addEventListener('click', regenerateToken);
  document.getElementById('validateDomainBtn').addEventListener('click', validateDomain);
  document.getElementById('launchBtn').addEventListener('click', launch);
  document.getElementById('domainInput').addEventListener('input', updateNgrokPreview);
  for (const button of document.querySelectorAll('[data-go]')) {
    button.addEventListener('click', () => goTo(Number.parseInt(button.dataset.go, 10)));
  }
}

bindEvents();
loadEditParams();
updateProgress();
if (state.token) document.getElementById('tokenBox').textContent = state.token;
