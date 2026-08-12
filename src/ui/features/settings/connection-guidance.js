import { esc as escapeHtml } from '../../utils.js';

export function chatGptFirstPrompt(workspaceAlias = 'myapp') {
  const alias = String(workspaceAlias || 'myapp').trim() || 'myapp';
  return `Use Rel.AI MCP on workspace "${alias.replaceAll('"', '\\"')}". Start a work session, snapshot the selected workspace, and inspect its repository structure. Do not modify files yet.`;
}

export function chatGptGuideSteps({ mode = 'create', tunnelId = '' } = {}) {
  const tunnel = String(tunnelId || '').trim();
  if (mode === 'reconnect') {
    return [
      'Keep Rel.AI running and confirm OpenAI Secure MCP Tunnel shows Connected on the Connection page.',
      'In ChatGPT, open your existing Rel.AI MCP app/plugin and reconnect or refresh it if ChatGPT asks.',
      tunnel ? `Confirm the ChatGPT integration is associated with tunnel ${tunnel}.` : 'Confirm the ChatGPT integration is associated with this computer’s Secure MCP Tunnel.',
      'Return to the chat, select Rel.AI MCP, and retry the request.'
    ];
  }
  return [
    'Create an OpenAI Secure MCP Tunnel for this computer and a runtime API key in OpenAI Platform.',
    'Save the tunnel ID and runtime key in Rel.AI Connection settings, then keep Rel.AI running until the tunnel reports Connected.',
    tunnel ? `In ChatGPT, create/add the Rel.AI MCP integration using the Tunnel connection option and select or enter ${tunnel}.` : 'In ChatGPT, create/add the Rel.AI MCP integration using the Tunnel connection option and select this computer’s tunnel.',
    'Enable Rel.AI MCP in the chat, then send the safe first request below.'
  ];
}

export function createChatGptSetupGuide(options = {}) {
  const mode = options.mode === 'reconnect' ? 'reconnect' : 'create';
  const guide = document.createElement(options.compact ? 'div' : 'section');
  guide.className = `chatgpt-setup-guide ${options.compact ? 'compact' : ''}`.trim();
  const title = mode === 'reconnect' ? 'Reconnect ChatGPT' : 'Connect ChatGPT';
  const steps = chatGptGuideSteps({ mode, tunnelId: options.tunnelId });
  guide.innerHTML = `
    <div class="chatgpt-guide-heading"><strong>${escapeHtml(title)}</strong><span>OpenAI Secure MCP Tunnel is the only supported connection path.</span></div>
    <ol>${steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
    <div class="chatgpt-first-prompt"><span>Safe first request</span><code>${escapeHtml(chatGptFirstPrompt(options.workspaceAlias))}</code></div>`;
  return guide;
}
