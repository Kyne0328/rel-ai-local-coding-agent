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
      'Keep Rel.AI running. Confirm that the Secure MCP Tunnel shows Connected on the Connection page.',
      'If you changed ChatGPT accounts or workspaces, sign in to the workspace that you want to use.',
      `If “${name}” already exists in that workspace, open it instead of creating a duplicate.`,
      tunnel ? `Set Connection to Tunnel and select ${tunnel}.` : 'Set Connection to Tunnel and select this computer’s Secure MCP Tunnel.',
      'Set Authentication to No authentication.',
      `If “${name}” does not exist in that workspace, create it once with these settings.`,
      `Enable “${name}” in the chat. Retry the request.`
    ];
  }
  return [
    'Open ChatGPT connector setup.',
    tunnel ? `Set Name to “${name}”. Set Connection to Tunnel. Select ${tunnel}. Set Authentication to No authentication.` : `Set Name to “${name}”. Set Connection to Tunnel. Select this computer’s tunnel. Set Authentication to No authentication.`,
    'Click Scan Tools. Confirm that the Rel.AI tools appear. Then click Create.',
    `Enable “${name}” in the chat.`,
    `Optional: Open Manage and upload ${RELAI_CONNECTOR_ICON_FILENAME} as the connector logo.`
  ];
}

export function createChatGptSetupGuide(options = {}) {
  const mode = options.mode === 'reconnect' ? 'reconnect' : 'create';
  const tunnelId = String(options.tunnelId || '').trim();
  const connectorName = String(options.connectorName || 'Rel.AI MCP').trim() || 'Rel.AI MCP';
  const guide = document.createElement(options.compact ? 'div' : 'section');
  guide.className = `chatgpt-setup-guide ${options.compact ? 'compact' : ''}`.trim();
  const title = mode === 'reconnect' ? 'Reconnect ChatGPT' : 'Finish ChatGPT setup';
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
        <button class="primary" type="button" data-open-chatgpt-setup>Open ChatGPT connector setup</button>
        <button class="secondary" type="button" data-save-relai-icon>Save optional Rel.AI icon <span>PNG · under 10 KB</span></button>
      </div>
      <p class="chatgpt-connector-note" data-chatgpt-handoff-note>Open ChatGPT now. You can add the Rel.AI icon after the connector works.</p>
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
    saveButton.textContent = `Optional icon saved · ${RELAI_CONNECTOR_ICON_FILENAME}`;
    if (note) note.textContent = 'The icon is optional. Open ChatGPT setup when you are ready.';
  });
  openButton?.addEventListener('click', () => {
    window.open(CHATGPT_CONNECTOR_CREATE_URL, '_blank', 'noopener,noreferrer');
  });
}

export {
  CHATGPT_CONNECTOR_CREATE_URL,
  RELAI_CONNECTOR_ICON_FILENAME,
  RELAI_CONNECTOR_ICON_URL
};
