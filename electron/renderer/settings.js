const params = new URLSearchParams(window.location.search);
const state = {
  port: Number.parseInt(params.get('port') || '3333', 10) || 3333,
  token: params.get('token') || '',
  ngrokAuth: params.get('ngrokToken') || '',
  ngrokDomain: normalizeDomain(params.get('domain') || ''),
  tokenChanged: false,
  notificationsEnabled: localStorage.getItem('relai_status_notifications') !== 'off'
};

function requestWindowFit() {
  window.requestAnimationFrame(() => {
    const shell = document.querySelector('.settings-shell');
    if (!shell || typeof window.electronAPI?.fitWindowToContent !== 'function') return;
    window.electronAPI.fitWindowToContent({
      width: Math.ceil(shell.getBoundingClientRect().width),
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

function normalizeDomain(value) {
  let domain = stripHttpProtocol(String(value || '').trim()).toLowerCase();
  while (domain.endsWith('/')) domain = domain.slice(0, -1);
  return domain;
}

function isDomainEdgeChar(character) {
  if (character?.length !== 1) return false;
  const code = character.codePointAt(0);
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
}

function isValidDomain(domain) {
  if (!domain || domain.length > 253 || !domain.includes('.')) return false;
  for (const character of domain) {
    if (character !== '.' && character !== '-' && !isDomainEdgeChar(character)) return false;
  }
  if (!isDomainEdgeChar(domain[0]) || !isDomainEdgeChar(domain.at(-1)) || domain.includes('..')) return false;
  return domain.split('.').every(label => label && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}

function setMessage(id, message, tone = '') {
  const element = document.getElementById(id);
  element.textContent = message;
  element.className = `field-message${tone ? ` ${tone}` : ''}`;
}

function syncFields() {
  state.port = Number.parseInt(document.getElementById('portInput').value, 10);
  state.ngrokDomain = normalizeDomain(document.getElementById('domainInput').value);
  state.ngrokAuth = String(document.getElementById('ngrokTokenInput').value || '').trim();
}

function validate({ announce = true } = {}) {
  syncFields();
  const portValid = Number.isInteger(state.port) && state.port >= 1024 && state.port <= 65535;
  const domainValid = isValidDomain(state.ngrokDomain);
  const keyValid = state.ngrokAuth.length >= 8 && !/\s/.test(state.ngrokAuth);

  if (announce || document.getElementById('portInput').value) {
    setMessage('portHint', portValid ? 'Port is valid.' : 'Enter a port between 1024 and 65535.', portValid ? 'success' : 'error');
  }
  if (announce || state.ngrokDomain) {
    setMessage('domainMessage', domainValid ? 'Domain is valid.' : 'Enter a valid static domain.', domainValid ? 'success' : 'error');
  }
  if (announce || state.ngrokAuth) {
    setMessage('ngrokTokenMessage', keyValid ? 'Account key format looks valid.' : 'Enter at least 8 characters with no spaces.', keyValid ? 'success' : 'error');
  }
  document.getElementById('saveBtn').disabled = !(portValid && domainValid && keyValid);
  return portValid && domainValid && keyValid;
}

function generateToken() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  state.token = btoa(String.fromCodePoint(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  state.tokenChanged = true;
  document.getElementById('tokenBox').textContent = state.token;
  document.getElementById('tokenWarning').hidden = false;
}

async function copyToken() {
  if (!state.token) return;
  const button = document.getElementById('copyTokenBtn');
  await window.electronAPI.copyUrl(state.token);
  const original = button.textContent;
  button.textContent = 'Copied';
  button.dataset.state = 'success';
  window.setTimeout(() => {
    button.textContent = original;
    delete button.dataset.state;
  }, 1300);
}

function toggleSecret() {
  const input = document.getElementById('ngrokTokenInput');
  const button = document.getElementById('toggleNgrokTokenBtn');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  button.textContent = showing ? 'Show' : 'Hide';
  button.setAttribute('aria-pressed', showing ? 'false' : 'true');
  input.focus();
}

function updateNotificationSwitch() {
  const button = document.getElementById('notificationToggleBtn');
  button.classList.toggle('enabled', state.notificationsEnabled);
  button.setAttribute('aria-checked', state.notificationsEnabled ? 'true' : 'false');
  document.getElementById('notificationState').textContent = state.notificationsEnabled ? 'On' : 'Off';
}

async function toggleNotifications() {
  state.notificationsEnabled = !state.notificationsEnabled;
  localStorage.setItem('relai_status_notifications', state.notificationsEnabled ? 'on' : 'off');
  updateNotificationSwitch();
  await window.electronAPI.setNotificationsEnabled(state.notificationsEnabled);
}

async function save() {
  if (!validate()) return;
  const button = document.getElementById('saveBtn');
  const error = document.getElementById('saveError');
  button.disabled = true;
  button.dataset.state = 'loading';
  button.textContent = 'Saving and restarting…';
  error.textContent = '';
  try {
    await window.electronAPI.wizardDone({
      port: state.port,
      token: state.token,
      ngrokAuthtoken: state.ngrokAuth,
      ngrokDomain: state.ngrokDomain,
      restart: true
    });
  } catch (caught) {
    error.textContent = caught instanceof Error ? caught.message : 'Settings could not be saved.';
    button.disabled = false;
    button.dataset.state = 'error';
    button.textContent = 'Try again';
    requestWindowFit();
  }
}

function initialize() {
  document.getElementById('portInput').value = state.port;
  document.getElementById('domainInput').value = state.ngrokDomain;
  document.getElementById('ngrokTokenInput').value = state.ngrokAuth;
  document.getElementById('tokenBox').textContent = state.token;
  updateNotificationSwitch();
  validate({ announce: false });
  window.electronAPI.getNotificationsEnabled()
    .then(result => {
      state.notificationsEnabled = result?.enabled !== false;
      updateNotificationSwitch();
    })
    .catch(() => {});

  for (const id of ['cancelBtn', 'cancelTopBtn']) {
    document.getElementById(id).addEventListener('click', () => window.electronAPI.closeWizard());
  }
  document.getElementById('saveBtn').addEventListener('click', save);
  document.getElementById('copyTokenBtn').addEventListener('click', copyToken);
  document.getElementById('regenTokenBtn').addEventListener('click', generateToken);
  document.getElementById('toggleNgrokTokenBtn').addEventListener('click', toggleSecret);
  document.getElementById('notificationToggleBtn').addEventListener('click', () => void toggleNotifications());
  for (const id of ['portInput', 'domainInput', 'ngrokTokenInput']) {
    document.getElementById(id).addEventListener('input', () => validate({ announce: false }));
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') window.electronAPI.closeWizard();
    if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      void save();
    }
  });
  requestWindowFit();
}

initialize();
