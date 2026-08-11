import { toast } from '../../components/toast.js';
import { requestDashboardRefresh } from '../../api.js';
import { markUnsaved } from '../../interaction-safety.js';
import { header, panel, field, numberControl } from './shared.js';
import { esc as escapeHtml } from '../../utils.js';
import { createChatGptSetupGuide } from './connection-guidance.js';

let state = null;
let savedConnectionState = null;
let replacementResult = null;
let tokenVisible = false;

export function mountDesktopConnection(container) {
  container.id = 'connectionControls';
  container.innerHTML = '<div class="settings-loading">Loading connection controls…</div>';
  if (!hasDesktopSettingsBridge()) {
    renderBrowserNotice(container);
    return;
  }
  return loadAndRender(container);
}

function hasDesktopSettingsBridge() {
  return Boolean(
    window.relaiDesktop?.getSettings
    && window.relaiDesktop?.saveSettings
    && window.relaiDesktop?.replaceApprovalToken
  );
}

async function loadAndRender(container) {
  try {
    const settings = await window.relaiDesktop.getSettings();
    state = {
      port: Number(settings.port || 3333),
      approvalToken: String(settings.approvalToken || ''),
      approvalRequired: settings.approvalRequired === true,
      ngrokDomain: normalizeDomain(settings.ngrokDomain || ''),
      ngrokAuthtoken: '',
      ngrokAuthtokenConfigured: settings.ngrokAuthtokenConfigured === true
    };
    savedConnectionState = connectionSnapshot(state);
    markUnsaved(container, false);
    render(container);
  } catch (error) {
    container.innerHTML = `<div class="empty">Connection controls could not be loaded: ${escapeHtml(messageOf(error))}</div>`;
  }
}

function renderBrowserNotice(container) {
  container.innerHTML = '';
  container.appendChild(header(
    'Tunnel and approval controls',
    'Secure connection credentials and approval-token controls are available inside the installed Rel.AI desktop app.'
  ));
  const notice = panel('Open the installed app');
  notice.body.innerHTML = '<p class="muted">Use the Rel.AI tray icon and choose Settings. The installed app opens this Connection page with secure desktop controls enabled.</p>';
  container.appendChild(notice.el);
}

function render(container) {
  container.innerHTML = '';
  container.appendChild(header(
    'Tunnel and approval controls',
    'Manage the secure endpoint and approval token. Saving tunnel credentials restarts the connection.'
  ));
  container.appendChild(connectionPanel(container).el);
  container.appendChild(approvalTokenPanel(container).el);
  container.appendChild(saveFooter(container));
}

function connectionPanel(container) {
  const connection = panel('Tunnel settings');
  connection.el.id = 'tunnelSettings';
  const sync = () => syncConnectionDirty(container);
  connection.body.appendChild(field(
    'Permanent ngrok domain',
    textControl(state.ngrokDomain, value => { state.ngrokDomain = normalizeDomain(value); sync(); }),
    'Enter the static domain without http://, https://, or a trailing slash.'
  ));
  connection.body.appendChild(field(
    'ngrok account key',
    secretControl(state.ngrokAuthtoken, value => { state.ngrokAuthtoken = value.trim(); sync(); }, {
      placeholder: state.ngrokAuthtokenConfigured ? 'Stored — enter a new key to replace it' : 'Enter ngrok account key'
    }),
    state.ngrokAuthtokenConfigured
      ? 'The stored key is never returned to this screen. Leave this blank to keep it, or enter a new key to replace it.'
      : 'The key is stored securely after saving and is not shown again.'
  ));

  const advanced = document.createElement('details');
  advanced.className = 'settings-advanced connection-advanced-settings';
  advanced.innerHTML = '<summary>Advanced connection settings</summary>';
  const advancedBody = document.createElement('div');
  advancedBody.className = 'settings-panel-body';
  advancedBody.appendChild(field(
    'Connection port',
    numberControl(state.port, value => { state.port = Number(value); sync(); }, { min: 1024, max: 65535 }),
    'Use a port from 1024 to 65535 only when the default conflicts with another application.'
  ));
  advanced.appendChild(advancedBody);
  connection.body.appendChild(advanced);
  return connection;
}

function approvalTokenPanel(container) {
  const access = panel('Approval token');
  access.el.id = 'approvalTokenSettings';
  access.body.classList.add('approval-token-settings');

  const intro = document.createElement('p');
  intro.className = 'muted approval-token-intro';
  intro.textContent = 'Use this token only on the Rel.AI authorization page opened by ChatGPT. Replacing it is a separate security action and does not change the MCP endpoint.';

  const tokenBox = document.createElement('div');
  tokenBox.className = 'approval-token-box';
  const token = document.createElement('code');
  token.className = 'copy-box connector-endpoint approval-token-value';
  renderToken(token);

  const actions = document.createElement('div');
  actions.className = 'connection-actions';
  const show = button(tokenVisible ? 'Hide token' : 'Show token', 'secondary', () => {
    tokenVisible = !tokenVisible;
    show.textContent = tokenVisible ? 'Hide token' : 'Show token';
    show.setAttribute('aria-pressed', tokenVisible ? 'true' : 'false');
    renderToken(token);
  });
  show.setAttribute('aria-pressed', tokenVisible ? 'true' : 'false');
  show.disabled = !state.approvalToken;
  const copy = button('Copy token', 'secondary', () => copyToken(copy));
  copy.disabled = !state.approvalToken;
  const openReplacement = button(state.approvalToken ? 'Replace approval token' : 'Create approval token', 'secondary', () => {
    replacement.hidden = false;
    openReplacement.hidden = true;
    confirmation.focus();
  });
  actions.append(show, copy, openReplacement);
  tokenBox.append(token, actions);

  const status = approvalStatusNotice();
  const success = replacementSuccessNotice();
  const { replacement, confirmation } = replacementConfirmation(container, openReplacement);

  access.body.append(intro, tokenBox);
  if (status) access.body.appendChild(status);
  if (success) access.body.appendChild(success);
  access.body.appendChild(replacement);
  return access;
}

function renderToken(element) {
  if (!state.approvalToken) {
    element.textContent = 'No approval token configured';
    return;
  }
  element.textContent = tokenVisible ? state.approvalToken : maskToken(state.approvalToken);
}

function maskToken(value) {
  const length = Math.max(18, Math.min(36, String(value || '').length));
  return '•'.repeat(length);
}

function approvalStatusNotice() {
  if (!state.approvalRequired) return null;
  const notice = document.createElement('div');
  notice.className = 'connection-notice warn approval-required-notice connection-auth-recovery';
  notice.appendChild(createChatGptSetupGuide({ mode: 'reconnect', compact: true }));
  return notice;
}

function replacementSuccessNotice() {
  if (!replacementResult) return null;
  const revoked = replacementResult.revoked || {};
  const restartRequired = replacementResult.restartRequired === true;
  const notice = document.createElement('div');
  notice.className = `connection-notice ${restartRequired ? 'warn' : 'ok'} approval-token-success`;
  const summary = document.createElement('div');
  summary.innerHTML = `
    <strong>${restartRequired ? 'Approval token replaced; restart the connection.' : 'Approval token replaced and ChatGPT access revoked.'}</strong>
    <p>Revoked access tokens: ${numberLabel(revoked.accessTokens)}. Revoked refresh tokens: ${numberLabel(revoked.refreshTokens)}. Preserved client registrations: ${numberLabel(revoked.registeredClientsPreserved)}.</p>`;
  notice.append(summary, createChatGptSetupGuide({ mode: 'reconnect', compact: true }));
  return notice;
}

function replacementConfirmation(container, openReplacement) {
  const replacement = document.createElement('div');
  replacement.className = 'approval-token-replacement';
  replacement.hidden = true;
  replacement.innerHTML = `
    <div class="approval-token-replacement-copy">
      <strong>Replace the approval token?</strong>
      <p>This security action takes effect immediately:</p>
      <ul>
        <li>The current approval token stops working.</li>
        <li>Active ChatGPT access and refresh tokens are revoked.</li>
        <li>The MCP endpoint and existing ChatGPT app stay the same.</li>
        <li>ChatGPT must be approved again with the new token.</li>
      </ul>
    </div>`;

  const confirmationField = document.createElement('label');
  confirmationField.className = 'settings-field approval-token-confirmation';
  const label = document.createElement('span');
  label.textContent = 'Type REPLACE to continue';
  const confirmation = document.createElement('input');
  confirmation.type = 'text';
  confirmation.autocomplete = 'off';
  confirmation.spellcheck = false;
  confirmation.placeholder = 'REPLACE';
  confirmation.setAttribute('aria-describedby', 'approval-token-confirmation-help');
  const help = document.createElement('small');
  help.id = 'approval-token-confirmation-help';
  help.className = 'settings-help';
  help.textContent = 'A new token is generated securely by the Electron main process.';
  confirmationField.append(label, confirmation, help);

  const actions = document.createElement('div');
  actions.className = 'connection-actions';
  const confirm = button('Replace token and revoke access', 'primary', () => replaceApprovalToken(container, confirm, confirmation));
  confirm.disabled = true;
  const cancel = button('Cancel', 'secondary', () => {
    confirmation.value = '';
    replacement.hidden = true;
    openReplacement.hidden = false;
  });
  confirmation.addEventListener('input', () => {
    confirm.disabled = confirmation.value.trim() !== 'REPLACE';
  });
  actions.append(confirm, cancel);
  replacement.append(confirmationField, actions);
  return { replacement, confirmation };
}

async function replaceApprovalToken(container, confirmButton, confirmation) {
  confirmButton.disabled = true;
  confirmButton.textContent = 'Replacing token and revoking access…';
  try {
    const result = await window.relaiDesktop.replaceApprovalToken({ confirmation: confirmation.value.trim() });
    replacementResult = result;
    tokenVisible = true;
    state.approvalToken = String(result.approvalToken || '');
    state.approvalRequired = result.authorization?.required !== false;
    toast(
      result.restartRequired
        ? 'Approval token replaced. Restart the service, then approve ChatGPT again.'
        : 'Approval token replaced. ChatGPT must be approved again.',
      { variant: result.restartRequired ? 'warn' : 'success' }
    );
    requestDashboardRefresh();
    render(container);
  } catch (error) {
    toast(messageOf(error), { variant: 'error' });
    confirmButton.disabled = false;
    confirmButton.textContent = 'Try replacement again';
  }
}

function saveFooter(container) {
  const footer = document.createElement('div');
  footer.className = 'settings-save-row';
  const message = document.createElement('div');
  message.className = 'muted';
  message.textContent = 'The approval token is shown only on request. The ngrok account key is never returned after saving.';
  const save = button('Save tunnel settings and restart connection', 'primary', () => saveSettings(container, save));
  footer.append(message, save);
  return footer;
}

function textControl(value, onChange) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => onChange(input.value));
  return input;
}

function secretControl(value, onChange, options = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'password-field';
  const input = document.createElement('input');
  input.type = 'password';
  input.value = value;
  input.placeholder = options.placeholder || '';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => onChange(input.value));
  const toggle = button('Show', 'secondary', () => {
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    toggle.textContent = visible ? 'Show' : 'Hide';
    toggle.setAttribute('aria-pressed', visible ? 'false' : 'true');
    input.focus();
  });
  toggle.classList.add('compact-button', 'password-toggle');
  toggle.setAttribute('aria-pressed', 'false');
  wrapper.append(input, toggle);
  return wrapper;
}

function button(label, className, onclick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  element.onclick = onclick;
  return element;
}

async function copyToken(buttonElement) {
  if (!state.approvalToken) return;
  try {
    await window.relaiDesktop.copyText(state.approvalToken);
    const original = buttonElement.textContent;
    buttonElement.textContent = 'Copied';
    window.setTimeout(() => { buttonElement.textContent = original; }, 1200);
  } catch (error) {
    toast(messageOf(error), { variant: 'error' });
  }
}

async function saveSettings(container, saveButton) {
  const error = validate();
  if (error) {
    toast(error, { variant: 'error' });
    return;
  }
  saveButton.disabled = true;
  saveButton.textContent = 'Saving and restarting connection…';
  try {
    await window.relaiDesktop.saveSettings({
      port: state.port,
      ngrokDomain: state.ngrokDomain,
      ngrokAuthtoken: state.ngrokAuthtoken
    });
    markUnsaved(container, false);
    toast('Tunnel settings saved. The connection restarted.', { variant: 'success' });
    requestDashboardRefresh({ structural: true });
  } catch (error) {
    toast(messageOf(error), { variant: 'error' });
    saveButton.disabled = false;
    saveButton.textContent = 'Try again';
  }
}

function validate() {
  if (!Number.isInteger(state.port) || state.port < 1024 || state.port > 65535) return 'Enter a connection service port from 1024 to 65535.';
  if (!isValidDomain(state.ngrokDomain)) return 'Enter a valid permanent ngrok domain.';
  if (!state.ngrokAuthtokenConfigured && !state.ngrokAuthtoken) return 'Enter your ngrok account key.';
  if (state.ngrokAuthtoken && (state.ngrokAuthtoken.length < 8 || /\s/.test(state.ngrokAuthtoken))) return 'Enter a valid ngrok account key with no spaces.';
  return '';
}

function connectionSnapshot(value) {
  return JSON.stringify({
    port: Number(value?.port || 0),
    ngrokDomain: normalizeDomain(value?.ngrokDomain || ''),
    replacementAccountKey: String(value?.ngrokAuthtoken || '').trim()
  });
}

function syncConnectionDirty(container) {
  markUnsaved(container, connectionSnapshot(state) !== savedConnectionState);
}

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function isValidDomain(domain) {
  if (!domain || domain.length > 253 || !domain.includes('.') || domain.includes('..')) return false;
  return domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

function numberLabel(value) {
  return Number(value || 0);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Connection settings failed.');
}
