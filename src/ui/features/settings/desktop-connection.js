import { toast } from '../../components/toast.js';
import { requestDashboardRefresh } from '../../api.js';
import { markUnsaved } from '../../interaction-safety.js';
import { field, numberControl } from './shared.js';
import { esc as escapeHtml } from '../../utils.js';

let state = null;
let savedState = '';

export function mountDesktopConnection(container, options = {}) {
  container.id = 'connectionControls';
  container.innerHTML = '<div class="settings-loading">Loading connection settings…</div>';
  if (!window.relaiDesktop?.getSettings || !window.relaiDesktop?.saveSettings) {
    container.innerHTML = '<div class="empty">Connection settings are available inside the installed Rel.AI desktop app.</div>';
    return;
  }
  return loadAndRender(container, options);
}

async function loadAndRender(container, options = {}) {
  try {
    const settings = await window.relaiDesktop.getSettings();
    state = {
      port: Number(settings.port || 3333),
      tunnelId: String(settings.tunnelId || ''),
      tunnelApiKey: '',
      tunnelApiKeyConfigured: settings.tunnelApiKeyConfigured === true,
      tunnelErrorCode: String(settings.tunnelErrorCode || ''),
      tunnelError: String(settings.tunnelError || '')
    };
    savedState = snapshot(state);
    markUnsaved(container, false);
    render(container, options);
  } catch (error) {
    container.innerHTML = `<div class="empty">Connection settings could not be loaded: ${escapeHtml(messageOf(error))}</div>`;
  }
}

function render(container, { expanded = false } = {}) {
  container.innerHTML = '';

  const disclosure = document.createElement('details');
  disclosure.className = 'card connector-details connection-settings-disclosure';
  disclosure.id = 'tunnelSettings';
  disclosure.open = Boolean(expanded || tunnelCredentialError(state));
  disclosure.innerHTML = '<summary class="connector-details-summary"><span><strong>Connection settings</strong><small>Secure tunnel credentials and local port</small></span><span aria-hidden="true">›</span></summary>';

  const disclosureBody = document.createElement('div');
  disclosureBody.className = 'card-body settings-panel-body';
  const intro = document.createElement('p');
  intro.className = 'muted';
  intro.textContent = 'Use these settings when connecting this computer for the first time or fixing a connection problem.';

  const fields = document.createElement('div');
  fields.className = 'settings-panel-body';
  fields.appendChild(field('Tunnel ID', textControl(state.tunnelId, value => { state.tunnelId = value.trim(); dirty(container); }), 'The OpenAI Secure MCP Tunnel ID for this computer.'));
  const runtimeKeyField = field('Runtime API key', secretControl(state.tunnelApiKey, value => { state.tunnelApiKey = value.trim(); dirty(container); }, state.tunnelApiKeyConfigured ? 'Stored securely. Enter a new key only to replace it.' : 'Paste runtime API key'), state.tunnelApiKeyConfigured ? 'The saved key is encrypted on this computer. Rel.AI does not show it again.' : 'Create a runtime API key for this Secure MCP Tunnel in OpenAI Platform.');
  const credentialError = tunnelCredentialError(state);
  if (credentialError) {
    const error = document.createElement('div');
    error.className = 'connection-key-error';
    error.setAttribute('role', 'alert');
    error.textContent = credentialError;
    runtimeKeyField.appendChild(error);
  }
  fields.appendChild(runtimeKeyField);
  fields.appendChild(accountWorkspaceSwitch());

  const advanced = document.createElement('details');
  advanced.className = 'settings-advanced connection-advanced-settings';
  advanced.innerHTML = '<summary>Advanced local settings</summary>';
  const advancedBody = document.createElement('div');
  advancedBody.className = 'settings-panel-body';
  advancedBody.appendChild(field('Local connection port', numberControl(state.port, value => { state.port = Number(value); dirty(container); }, { min: 1024, max: 65535 }), 'Change this only when port 3333 conflicts with another local application.'));
  advanced.appendChild(advancedBody);
  fields.appendChild(advanced);

  const footer = document.createElement('div');
  footer.className = 'connection-actions';
  footer.innerHTML = '<div class="muted">Changing the tunnel reconnects the tunnel only. Changing the local port restarts the full Rel.AI connection.</div>';
  const save = button('Save connection settings', 'primary', () => saveSettings(container, save));
  footer.appendChild(save);

  disclosureBody.append(intro, fields, footer);
  disclosure.appendChild(disclosureBody);
  container.appendChild(disclosure);
}

async function saveSettings(container, saveButton) {
  const error = validate();
  if (error) return toast(error, { variant: 'error' });
  saveButton.disabled = true;
  saveButton.textContent = 'Saving and restarting…';
  try {
    const result = await window.relaiDesktop.saveSettings({ port: state.port, tunnelId: state.tunnelId, tunnelApiKey: state.tunnelApiKey });
    savedState = snapshot({ ...state, tunnelApiKey: '' });
    state.tunnelApiKey = '';
    state.tunnelApiKeyConfigured = true;
    state.tunnelErrorCode = String(result?.errorCode || result?.status?.errorCode || '');
    state.tunnelError = String(result?.error || result?.status?.error || '');
    markUnsaved(container, false);
    requestDashboardRefresh({ structural: true });
    if (result?.ok === false) {
      render(container, { expanded: true });
      toast(result.error || 'Connection settings were saved, but the Secure MCP Tunnel could not connect.', { variant: 'error' });
      return;
    }
    state.tunnelErrorCode = '';
    state.tunnelError = '';
    toast('Connection settings saved. Rel.AI reconnected.', { variant: 'success' });
  } catch (error) {
    toast(messageOf(error), { variant: 'error' });
    saveButton.disabled = false;
    saveButton.textContent = 'Try again';
  }
}

function validate() {
  if (!Number.isInteger(state.port) || state.port < 1024 || state.port > 65535) return 'Enter a local connection port from 1024 to 65535.';
  if (!/^tunnel_[A-Za-z0-9_-]{8,200}$/.test(state.tunnelId)) return 'Enter a valid OpenAI Secure MCP Tunnel ID beginning with tunnel_.';
  if (!state.tunnelApiKeyConfigured && !state.tunnelApiKey) return 'Enter the OpenAI Secure MCP Tunnel runtime API key.';
  if (state.tunnelApiKey && (state.tunnelApiKey.length < 12 || /\s/.test(state.tunnelApiKey))) return 'Enter a valid runtime API key with no spaces.';
  return '';
}

function accountWorkspaceSwitch() {
  const details = document.createElement('details');
  details.className = 'settings-advanced connection-account-switch';
  details.innerHTML = `
    <summary>Use a different OpenAI account or workspace</summary>
    <div class="settings-panel-body connection-account-switch-body">
      <ol>
        <li>Sign in to the OpenAI account that you want to use.</li>
        <li>Select or create a Secure MCP Tunnel in that organization.</li>
        <li>Create a runtime API key for that tunnel.</li>
        <li>Replace the Tunnel ID and runtime API key above. Then save the connection settings.</li>
        <li>In ChatGPT, update the existing Rel.AI connector if it is available in that workspace. Create one connector only if the workspace does not have it.</li>
      </ol>
      <div class="connection-account-switch-actions">
        <a class="buttonlike secondary compact-button" href="https://platform.openai.com/settings/organization/tunnels" target="_blank" rel="noopener noreferrer">Open OpenAI Tunnels</a>
        <a class="buttonlike secondary compact-button" href="https://platform.openai.com/settings/organization/api-keys" target="_blank" rel="noopener noreferrer">Open OpenAI API Keys</a>
      </div>
    </div>`;
  return details;
}

function textControl(value, onChange) {
  const input = document.createElement('input');
  input.type = 'text'; input.value = value; input.autocomplete = 'off'; input.spellcheck = false;
  input.addEventListener('input', () => onChange(input.value));
  return input;
}

function secretControl(value, onChange, placeholder) {
  const wrapper = document.createElement('div'); wrapper.className = 'password-field';
  const input = document.createElement('input'); input.type = 'password'; input.value = value; input.placeholder = placeholder; input.autocomplete = 'off'; input.spellcheck = false;
  input.addEventListener('input', () => onChange(input.value));
  const toggle = button('Show', 'secondary', () => { const hidden = input.type === 'password'; input.type = hidden ? 'text' : 'password'; toggle.textContent = hidden ? 'Hide' : 'Show'; input.focus(); });
  toggle.classList.add('compact-button', 'password-toggle'); wrapper.append(input, toggle); return wrapper;
}

function button(label, className, onclick) { const element = document.createElement('button'); element.type = 'button'; element.className = className; element.textContent = label; element.onclick = onclick; return element; }
function snapshot(value) { return JSON.stringify({ port: Number(value?.port || 0), tunnelId: String(value?.tunnelId || '').trim(), replacementKey: String(value?.tunnelApiKey || '').trim() }); }
function dirty(container) { markUnsaved(container, snapshot(state) !== savedState); }
function tunnelCredentialError(value = {}) {
  const code = String(value.tunnelErrorCode || '');
  if (code === 'tunnel_authentication_failed') return value.tunnelError || 'OpenAI rejected the runtime API key. Replace it with the correct key, then reconnect.';
  if (code === 'tunnel_access_denied') return value.tunnelError || 'This runtime API key does not have access to the configured tunnel.';
  if (code === 'tunnel_not_found') return value.tunnelError || 'The configured tunnel could not be found for this OpenAI account.';
  return '';
}
function messageOf(error) { return error instanceof Error ? error.message : String(error || 'Connection settings failed.'); }
