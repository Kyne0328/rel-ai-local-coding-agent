import { toast } from '../../components/toast.js';
import { requestDashboardRefresh } from '../../api.js';
import { markUnsaved } from '../../interaction-safety.js';
import { header, panel, field, numberControl } from './shared.js';
import { esc as escapeHtml } from '../../utils.js';

let state = null;
let savedState = '';

export function mountDesktopConnection(container) {
  container.id = 'connectionControls';
  container.innerHTML = '<div class="settings-loading">Loading connection settings…</div>';
  if (!window.relaiDesktop?.getSettings || !window.relaiDesktop?.saveSettings) {
    container.innerHTML = '<div class="empty">Connection settings are available inside the installed Rel.AI desktop app.</div>';
    return;
  }
  return loadAndRender(container);
}

async function loadAndRender(container) {
  try {
    const settings = await window.relaiDesktop.getSettings();
    state = {
      port: Number(settings.port || 3333),
      tunnelId: String(settings.tunnelId || ''),
      tunnelApiKey: '',
      tunnelApiKeyConfigured: settings.tunnelApiKeyConfigured === true
    };
    savedState = snapshot(state);
    markUnsaved(container, false);
    render(container);
  } catch (error) {
    container.innerHTML = `<div class="empty">Connection settings could not be loaded: ${escapeHtml(messageOf(error))}</div>`;
  }
}

function render(container) {
  container.innerHTML = '';
  container.appendChild(header('ChatGPT connection', 'Rel.AI connects ChatGPT to your project files while file access and commands stay on this computer.'));
  const connection = panel('Connection settings');
  connection.el.id = 'tunnelSettings';
  connection.body.appendChild(field('Tunnel ID', textControl(state.tunnelId, value => { state.tunnelId = value.trim(); dirty(container); }), 'The OpenAI Secure MCP Tunnel ID for this computer.'));
  connection.body.appendChild(field('Runtime API key', secretControl(state.tunnelApiKey, value => { state.tunnelApiKey = value.trim(); dirty(container); }, state.tunnelApiKeyConfigured ? 'Stored securely — enter a new key only to replace it' : 'Paste runtime API key'), state.tunnelApiKeyConfigured ? 'The saved key for this Secure MCP Tunnel is encrypted on this computer and is never shown again.' : 'Create a runtime API key for this Secure MCP Tunnel in OpenAI Platform.'));
  const advanced = document.createElement('details');
  advanced.className = 'settings-advanced connection-advanced-settings';
  advanced.innerHTML = '<summary>Advanced local settings</summary>';
  const body = document.createElement('div');
  body.className = 'settings-panel-body';
  body.appendChild(field('Local connection port', numberControl(state.port, value => { state.port = Number(value); dirty(container); }, { min: 1024, max: 65535 }), 'Change this only when port 3333 conflicts with another local application.'));
  advanced.appendChild(body);
  connection.body.appendChild(advanced);
  container.appendChild(connection.el);

  const footer = document.createElement('div');
  footer.className = 'settings-save-row';
  footer.innerHTML = '<div class="muted">Saving restarts the local Rel.AI connection.</div>';
  const save = button('Save and restart connection', 'primary', () => saveSettings(container, save));
  footer.appendChild(save);
  container.appendChild(footer);
}

async function saveSettings(container, saveButton) {
  const error = validate();
  if (error) return toast(error, { variant: 'error' });
  saveButton.disabled = true;
  saveButton.textContent = 'Saving and restarting…';
  try {
    await window.relaiDesktop.saveSettings({ port: state.port, tunnelId: state.tunnelId, tunnelApiKey: state.tunnelApiKey });
    savedState = snapshot({ ...state, tunnelApiKey: '' });
    state.tunnelApiKey = '';
    state.tunnelApiKeyConfigured = true;
    markUnsaved(container, false);
    toast('Connection settings saved. Rel.AI reconnected.', { variant: 'success' });
    requestDashboardRefresh({ structural: true });
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
function messageOf(error) { return error instanceof Error ? error.message : String(error || 'Connection settings failed.'); }
