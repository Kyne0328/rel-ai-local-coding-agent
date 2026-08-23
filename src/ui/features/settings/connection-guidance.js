import { esc as escapeHtml } from '../../utils.js';

const CHATGPT_CONNECTOR_CREATE_URL = 'https://chatgpt.com/plugins#settings/Connectors?create-connector=true';
const RELAI_CONNECTOR_ICON_URL = '/assets/favicon.png';
const RELAI_CONNECTOR_ICON_FILENAME = 'relai-mcp.png';

export function chatGptFirstPrompt(workspaceAlias = 'myapp') {
  const alias = String(workspaceAlias || 'myapp').trim() || 'myapp';
  return `Use Rel.AI MCP with project "${alias.replaceAll('"', '\\"')}". Look through its files and folders and summarize the project structure. Do not change any files yet.`;
}

export function chatGptGuideSteps({ mode = 'create', tunnelId = '', connectorName = 'Rel.AI MCP' } = {}) {
  const tunnel = String(tunnelId || '').trim();
  const name = String(connectorName || 'Rel.AI MCP').trim() || 'Rel.AI MCP';
  if (mode === 'reconnect') {
    return [
      'Keep Rel.AI running and confirm OpenAI Secure MCP Tunnel shows Connected on the Connection page.',
      `In ChatGPT, open the existing “${name}” connector instead of creating a duplicate.`,
      tunnel ? `Reconnect it with Connection set to Tunnel and select ${tunnel}.` : 'Reconnect it with Connection set to Tunnel and select this computer’s Secure MCP Tunnel.',
      'Set Authentication to No authentication. Do not choose OAuth for the Rel.AI tunnel connection.',
      `Return to the chat, enable “${name}”, and retry the request.`
    ];
  }
  return [
    'In OpenAI Platform, create or select a Secure MCP Tunnel under Organization settings → Tunnels. Complete Name, Description, Organizations, and ChatGPT workspaces, choosing the organization(s) and workspace(s) where you will actually use Rel.AI, then copy its tunnel_ ID.',
    'Under Organization settings → API Keys, create an API key for the tunnel with Tunnel Read and Use permissions.',
    'Save the Tunnel ID and API key in Rel.AI Connection settings, then keep Rel.AI running until the connection shows Connected.',
    'Save the Rel.AI icon below before opening ChatGPT connector creation.',
    tunnel ? `In ChatGPT, use Name “${name}”, Connection “Tunnel”, select ${tunnel}, and set Authentication to “No authentication”.` : `In ChatGPT, use Name “${name}”, Connection “Tunnel”, select this computer’s tunnel, and set Authentication to “No authentication”.`,
    'Click Scan Tools, confirm the Rel.AI tools appear, then click Create.',
    `After creation, open Manage and upload ${RELAI_CONNECTOR_ICON_FILENAME} as the connector logo, then enable “${name}” in the chat.`
  ];
}

export function createChatGptSetupGuide(options = {}) {
  const mode = options.mode === 'reconnect' ? 'reconnect' : 'create';
  const tunnelId = String(options.tunnelId || '').trim();
  const connectorName = String(options.connectorName || 'Rel.AI MCP').trim() || 'Rel.AI MCP';
  const guide = document.createElement(options.compact ? 'div' : 'section');
  guide.className = `chatgpt-setup-guide ${options.compact ? 'compact' : ''}`.trim();
  const title = mode === 'reconnect' ? 'Reconnect ChatGPT' : 'Connect ChatGPT';
  const steps = chatGptGuideSteps({ mode, tunnelId, connectorName });
  guide.innerHTML = `
    <div class="chatgpt-guide-heading"><strong>${escapeHtml(title)}</strong><span>Use Tunnel + No authentication. Rel.AI keeps the local connection private.</span></div>
    ${mode === 'create' ? connectorHandoffHtml(tunnelId, connectorName) : ''}
    <ol>${steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
    <div class="chatgpt-first-prompt"><span>First test request</span><code>${escapeHtml(chatGptFirstPrompt(options.workspaceAlias))}</code></div>`;
  if (mode === 'create') bindConnectorHandoff(guide);
  return guide;
}

function connectorHandoffHtml(tunnelId, connectorName) {
  return `
    <section class="chatgpt-connector-handoff" aria-label="ChatGPT connector setup">
      <dl class="chatgpt-connector-values">
        <dt>Name</dt><dd>${escapeHtml(connectorName)}</dd>
        <dt>Connection</dt><dd>Tunnel</dd>
        <dt>Tunnel</dt><dd class="mono">${escapeHtml(tunnelId || 'Select this computer’s tunnel')}</dd>
        <dt>Authentication</dt><dd>No authentication</dd>
      </dl>
      <div class="chatgpt-connector-actions" role="group" aria-label="ChatGPT connector setup actions">
        <button class="secondary" type="button" data-save-relai-icon>Save Rel.AI icon <span>PNG · under 10 KB</span></button>
        <button class="primary" type="button" data-open-chatgpt-setup disabled>Open ChatGPT plugin setup</button>
      </div>
      <p class="chatgpt-connector-note" data-chatgpt-handoff-note>Save the icon first. The next button opens ChatGPT Plugins with the + connector form ready.</p>
    </section>`;
}

function bindConnectorHandoff(guide) {
  const saveButton = guide.querySelector('[data-save-relai-icon]');
  const openButton = guide.querySelector('[data-open-chatgpt-setup]');
  const note = guide.querySelector('[data-chatgpt-handoff-note]');
  saveButton?.addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = RELAI_CONNECTOR_ICON_URL;
    link.download = RELAI_CONNECTOR_ICON_FILENAME;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (openButton) openButton.disabled = false;
    saveButton.textContent = `Icon ready · ${RELAI_CONNECTOR_ICON_FILENAME}`;
    if (note) note.textContent = 'Next, open ChatGPT setup. After Create, use Manage to upload the saved icon as the connector logo.';
  });
  openButton?.addEventListener('click', () => {
    if (openButton.disabled) return;
    window.open(CHATGPT_CONNECTOR_CREATE_URL, '_blank', 'noopener,noreferrer');
  });
}

export {
  CHATGPT_CONNECTOR_CREATE_URL,
  RELAI_CONNECTOR_ICON_FILENAME,
  RELAI_CONNECTOR_ICON_URL
};
