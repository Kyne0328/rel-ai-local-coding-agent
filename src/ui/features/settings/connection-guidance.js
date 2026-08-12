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
      'In ChatGPT, open the existing Rel.AI MCP plugin/app instead of creating a duplicate.',
      tunnel ? `Reconnect it with Connection set to Tunnel and select ${tunnel}.` : 'Reconnect it with Connection set to Tunnel and select this computer’s Secure MCP Tunnel.',
      'Set Authentication to No authentication. Do not choose OAuth for the Rel.AI tunnel connection.',
      'Return to the chat, enable Rel.AI MCP, and retry the request.'
    ];
  }
  return [
    'In OpenAI Platform, create or select a Secure MCP Tunnel under Organization settings → Tunnels and copy its tunnel_ ID.',
    'Under Organization settings → API Keys, create a restricted runtime key with Tunnel Read and Use permissions.',
    'Save the Tunnel ID and runtime key in Rel.AI Connection settings, then keep Rel.AI running until the tunnel reports Connected.',
    tunnel ? `In ChatGPT, create/add Rel.AI MCP with Connection set to Tunnel, select ${tunnel}, and set Authentication to No authentication.` : 'In ChatGPT, create/add Rel.AI MCP with Connection set to Tunnel, select this computer’s tunnel, and set Authentication to No authentication.',
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
    <div class="chatgpt-guide-heading"><strong>${escapeHtml(title)}</strong><span>Use Tunnel + No authentication. Rel.AI handles the local bearer credential.</span></div>
    <ol>${steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
    <div class="chatgpt-first-prompt"><span>Safe first request</span><code>${escapeHtml(chatGptFirstPrompt(options.workspaceAlias))}</code></div>`;
  return guide;
}
