const state = {
  port: 3333,
  token: '',
  ngrokAuth: '',
  ngrokDomain: '',
  editMode: false
};

const STEP_COUNT = 4;
let currentStep = 1;
let launchPending = false;

const ngrokLinks = {
  signup: 'https://dashboard.ngrok.com/signup',
  authtoken: 'https://dashboard.ngrok.com/get-started/your-authtoken',
  domains: 'https://dashboard.ngrok.com/domains'
};

function requestWindowFit() {
  window.requestAnimationFrame(() => {
    const wizard = document.querySelector('.wizard');
    if (!wizard || typeof window.electronAPI?.fitWindowToContent !== 'function') return;
    window.electronAPI.fitWindowToContent({
      width: Math.ceil(wizard.getBoundingClientRect().width),
      height: Math.ceil(document.documentElement.scrollHeight)
    });
  });
}

function stripHttpProtocol(value) {
  const text = String(value || '');
  const lower = text.toLowerCase();
  if (lower.startsWith('https://')) return text.slice(8);
  if (lower.startsWith('http://')) return text.slice(7);
  return text;
}

function isDomainEdgeChar(character) {
  if (character?.length !== 1) return false;
  const code = character.codePointAt(0);
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
}

function hasOnlyDomainChars(value) {
  for (const character of value) {
    if (character !== '.' && character !== '-' && !isDomainEdgeChar(character)) return false;
  }
  return true;
}

function normalizeDomain(value) {
  let domain = stripHttpProtocol(String(value || '').trim()).toLowerCase();
  while (domain.endsWith('/')) domain = domain.slice(0, -1);
  return domain;
}

function isValidDomain(domain) {
  if (!domain || domain.length > 253 || !domain.includes('.')) return false;
  if (!hasOnlyDomainChars(domain) || !isDomainEdgeChar(domain[0]) || !isDomainEdgeChar(domain.at(-1))) return false;
  if (domain.includes('..')) return false;
  return domain.split('.').every(label => label && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}

function isValidPort(value) {
  return Number.isInteger(value) && value >= 1024 && value <= 65535;
}

function isValidNgrokKey(value) {
  return Boolean(value) && value.length >= 8 && !/\s/.test(value);
}

function setMessage(elementId, message, tone = '') {
  const element = document.getElementById(elementId);
  if (!element) return;
  element.textContent = message;
  element.className = `field-message${tone ? ` ${tone}` : ''}`;
}

function generateToken() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  state.token = btoa(String.fromCodePoint(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  document.getElementById('tokenBox').textContent = state.token;
}

function syncLocalState() {
  state.port = Number.parseInt(document.getElementById('portInput').value, 10);
}

function syncConnectionState() {
  state.ngrokAuth = String(document.getElementById('ngrokTokenInput').value || '').trim();
  state.ngrokDomain = normalizeDomain(document.getElementById('domainInput').value);
}

function validateLocalFields({ announce = true } = {}) {
  syncLocalState();
  const valid = isValidPort(state.port);
  if (announce || document.getElementById('portInput').value) {
    setMessage('portHint', valid ? 'Port is valid.' : 'Enter a port between 1024 and 65535.', valid ? 'success' : 'error');
  }
  document.getElementById('continueLocalBtn').disabled = !valid;
  return valid;
}

function validateConnectionFields({ announce = true } = {}) {
  syncConnectionState();
  const keyValid = isValidNgrokKey(state.ngrokAuth);
  const domainValid = isValidDomain(state.ngrokDomain);

  if (announce || state.ngrokAuth) {
    setMessage(
      'ngrokTokenMessage',
      keyValid ? 'Account key format looks valid.' : 'Enter an account key with at least 8 characters and no spaces.',
      keyValid ? 'success' : 'error'
    );
  }
  if (announce || state.ngrokDomain) {
    setMessage(
      'domainMessage',
      domainValid ? 'Static domain is valid.' : 'Enter a valid domain such as your-name.ngrok-free.dev.',
      domainValid ? 'success' : 'error'
    );
  }

  document.getElementById('reviewSetupBtn').disabled = !(keyValid && domainValid);
  updateNgrokPreview();
  return keyValid && domainValid;
}

function goTo(stepNumber) {
  const nextStep = Math.min(STEP_COUNT, Math.max(1, stepNumber));
  const previousSection = document.getElementById(`step${currentStep}`);
  previousSection?.classList.remove('active');
  if (previousSection) {
    previousSection.hidden = true;
    previousSection.setAttribute('aria-hidden', 'true');
  }
  currentStep = nextStep;
  const nextSection = document.getElementById(`step${currentStep}`);
  if (nextSection) {
    nextSection.hidden = false;
    nextSection.setAttribute('aria-hidden', 'false');
    nextSection.classList.add('active');
  }
  updateProgress();

  if (currentStep === 2) {
    if (!state.token) generateToken();
    validateLocalFields({ announce: false });
    window.setTimeout(() => document.getElementById('portInput')?.focus(), 0);
  }
  if (currentStep === 3) {
    validateConnectionFields({ announce: false });
    window.setTimeout(() => document.getElementById('ngrokTokenInput')?.focus(), 0);
  }
  if (currentStep === 4) {
    renderSummary();
    window.setTimeout(() => document.getElementById('step4Title')?.focus(), 0);
  }
  requestWindowFit();
}

function updateProgress() {
  for (let index = 1; index <= STEP_COUNT; index += 1) {
    const step = document.getElementById(`p${index}`);
    step.classList.toggle('done', index < currentStep);
    step.classList.toggle('current', index === currentStep);
    if (index === currentStep) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  }
}

async function copyToken() {
  if (!state.token) return;
  const button = document.getElementById('copyTokenBtn');
  await window.electronAPI.copyUrl(state.token);
  showButtonSuccess(button, 'Copied', 'Copy token');
}

function showButtonSuccess(button, successText, idleText) {
  button.disabled = true;
  button.dataset.state = 'success';
  button.textContent = successText;
  window.setTimeout(() => {
    button.disabled = false;
    delete button.dataset.state;
    button.textContent = idleText;
  }, 1300);
}

function updateNgrokPreview() {
  const domain = normalizeDomain(document.getElementById('domainInput').value);
  const port = Number.parseInt(document.getElementById('portInput').value, 10) || state.port;
  document.getElementById('ngrokCmdPreview').textContent = `managed ngrok tunnel for ${domain || '<domain>'} on local port ${port}`;
}

function renderSummary() {
  syncLocalState();
  syncConnectionState();
  const box = document.getElementById('summaryBox');
  box.innerHTML = '';
  const rows = [
    ['Local service', `http://127.0.0.1:${state.port}`],
    ['Approval token', 'Stored privately in ~/.rel-ai-mcp/.env'],
    ['ngrok account key', 'Stored privately in Rel.AI ngrok.yml'],
    ['ChatGPT endpoint', `https://${state.ngrokDomain}/mcp`]
  ];
  for (const [key, value] of rows) {
    const row = document.createElement('div');
    row.className = 'summary-row';
    const keyElement = document.createElement('span');
    keyElement.className = 'summary-key';
    keyElement.textContent = key;
    const valueElement = document.createElement('span');
    valueElement.className = 'summary-val';
    valueElement.textContent = value;
    row.append(keyElement, valueElement);
    box.append(row);
  }
}

async function launch() {
  if (launchPending) return;
  if (!validateLocalFields() || !validateConnectionFields()) {
    goTo(!isValidPort(state.port) ? 2 : 3);
    return;
  }

  launchPending = true;
  const errorElement = document.getElementById('launchError');
  const button = document.getElementById('launchBtn');
  errorElement.textContent = '';
  button.disabled = true;
  button.dataset.state = 'loading';
  button.textContent = state.editMode ? 'Saving and restarting…' : 'Saving and starting…';
  requestWindowFit();

  try {
    await window.electronAPI.wizardDone({
      port: state.port,
      token: state.token,
      ngrokAuthtoken: state.ngrokAuth,
      ngrokDomain: state.ngrokDomain,
      restart: state.editMode
    });
  } catch (error) {
    launchPending = false;
    errorElement.textContent = error instanceof Error ? error.message : 'Rel.AI could not launch.';
    button.disabled = false;
    button.dataset.state = 'error';
    button.textContent = 'Try again';
    requestWindowFit();
  }
}

async function loadRecoveryConfig() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('recovery') !== '1') return false;

  state.editMode = true;
  const config = await window.electronAPI.getRecoveryConfig();
  state.port = Number.parseInt(config.port || '3333', 10) || 3333;
  state.token = String(config.token || '');
  state.ngrokAuth = String(config.ngrokAuthtoken || '');
  state.ngrokDomain = normalizeDomain(config.ngrokDomain || '');

  document.title = 'Rel.AI MCP - Connection Recovery';
  document.getElementById('wizardBrandTitle').textContent = 'Rel.AI MCP Recovery';
  document.getElementById('wizardBrandSub').textContent = 'Fallback connection editor';
  document.getElementById('step2Title').textContent = 'Repair the local service.';
  document.getElementById('step3Title').textContent = 'Repair the secure connection.';
  document.getElementById('step4Title').textContent = 'Review and retry.';
  document.querySelector('#p4 strong').textContent = 'Retry';
  document.getElementById('launchBtn').textContent = 'Save and retry connection';
  document.getElementById('portInput').value = state.port;
  document.getElementById('ngrokTokenInput').value = state.ngrokAuth;
  document.getElementById('domainInput').value = state.ngrokDomain;
  document.getElementById('tokenBox').textContent = state.token;
  document.getElementById('regenTokenBtn').hidden = true;
  document.getElementById('tokenHint').textContent = 'The current approval token is preserved. Replace it later from Settings > Connection after the dashboard is restored.';
  return true;
}

function toggleNgrokKeyVisibility() {
  const input = document.getElementById('ngrokTokenInput');
  const button = document.getElementById('toggleNgrokTokenBtn');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  button.textContent = showing ? 'Show' : 'Hide';
  button.setAttribute('aria-pressed', showing ? 'false' : 'true');
  input.focus();
}

function continueLocal() {
  if (validateLocalFields()) goTo(3);
}

function reviewSetup() {
  if (validateConnectionFields()) goTo(4);
}

function handleEnter(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.target instanceof HTMLButtonElement) return;
  event.preventDefault();
  if (currentStep === 2) continueLocal();
  else if (currentStep === 3) reviewSetup();
  else if (currentStep === 4) launch();
}

function bindEvents() {
  document.getElementById('startWizardBtn').addEventListener('click', () => goTo(2));
  document.getElementById('continueLocalBtn').addEventListener('click', continueLocal);
  document.getElementById('copyTokenBtn').addEventListener('click', copyToken);
  document.getElementById('regenTokenBtn').addEventListener('click', () => {
    generateToken();
    showButtonSuccess(document.getElementById('regenTokenBtn'), 'New token ready', 'Generate a new token');
  });
  document.getElementById('reviewSetupBtn').addEventListener('click', reviewSetup);
  document.getElementById('launchBtn').addEventListener('click', launch);
  document.getElementById('toggleNgrokTokenBtn').addEventListener('click', toggleNgrokKeyVisibility);
  document.getElementById('portInput').addEventListener('input', () => validateLocalFields({ announce: false }));
  document.getElementById('ngrokTokenInput').addEventListener('input', () => validateConnectionFields({ announce: false }));
  document.getElementById('domainInput').addEventListener('input', () => validateConnectionFields({ announce: false }));
  document.addEventListener('keydown', handleEnter);

  for (const button of document.querySelectorAll('[data-go]')) {
    button.addEventListener('click', () => goTo(Number.parseInt(button.dataset.go, 10)));
  }
  for (const button of document.querySelectorAll('[data-link]')) {
    button.addEventListener('click', () => {
      const url = ngrokLinks[button.dataset.link];
      if (url && typeof window.electronAPI?.openExternal === 'function') window.electronAPI.openExternal(url);
    });
  }
}

async function initialize() {
  try {
    await loadRecoveryConfig();
    if (!state.token) generateToken();
    bindEvents();
    updateProgress();
    validateLocalFields({ announce: false });
    validateConnectionFields({ announce: false });
    if (state.editMode) goTo(2);
    else requestWindowFit();
  } catch (error) {
    document.getElementById('launchError').textContent = error instanceof Error ? error.message : 'Recovery settings could not be loaded.';
    bindEvents();
    updateProgress();
    goTo(2);
  }
}

initialize().catch(() => {});
