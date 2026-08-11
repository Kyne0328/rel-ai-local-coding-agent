import { esc as escapeHtml } from '../../utils.js';

export function chatGptFirstPrompt(workspaceAlias = 'myapp') {
  const alias = String(workspaceAlias || 'myapp').trim() || 'myapp';
  return `Use Rel.AI MCP on workspace "${alias.replaceAll('"', '\\"')}". Start a work session, snapshot the selected workspace, and inspect its repository structure. Do not modify files yet.`;
}

export function chatGptGuideSteps({ mode = 'create', endpointAvailable = true, developerModeRequired = true } = {}) {
  if (mode === 'reconnect') {
    return [
      'In ChatGPT Web, use the integration page for your plan: Plus or Pro → Plugins (sidebar or Settings > Plugins); Business, Enterprise, or Edu → the Rel.AI app under workspace Apps. Select the existing Rel.AI MCP integration.',
      'Choose Connect or Reconnect when available. The endpoint is unchanged; keep the existing Rel.AI MCP app and do not delete or recreate the app.',
      'When the Rel.AI authorization page opens, copy the current approval token from this Connection page and approve access.',
      'Return to ChatGPT, enable or select Rel.AI MCP in the chat, then retry your request.'
    ];
  }
  const createLocation = developerModeRequired
    ? 'In ChatGPT Web, Plus or Pro users should open Plugins (sidebar or Settings > Plugins) and add Rel.AI MCP there. Enable Developer mode if the custom MCP option is hidden. Business, Enterprise, or Edu users should use the Rel.AI app under workspace Apps.'
    : 'In ChatGPT Web, Plus or Pro users should open Plugins (sidebar or Settings > Plugins) and add Rel.AI MCP there. Business, Enterprise, or Edu users should use the Rel.AI app under workspace Apps.';
  return [
    createLocation,
    endpointAvailable
      ? 'Name the app Rel.AI MCP, paste the MCP endpoint shown on this page into the MCP server URL, choose OAuth, then refresh or scan the available tools.'
      : 'Finish the Rel.AI secure connection first. When an MCP endpoint appears on this page, paste it into ChatGPT and choose OAuth.',
    'Create or connect the app. When the Rel.AI authorization page opens, copy the approval token from this Connection page and approve access.',
    'Return to ChatGPT, enable or select Rel.AI MCP in the chat, then send the safe first request below.'
  ];
}

export function createChatGptSetupGuide(options = {}) {
  const mode = options.mode === 'reconnect' ? 'reconnect' : 'create';
  const guide = document.createElement(options.compact ? 'div' : 'section');
  guide.className = `chatgpt-setup-guide ${options.compact ? 'compact' : ''}`.trim();
  const title = mode === 'reconnect' ? 'Reconnect ChatGPT' : 'Connect ChatGPT';
  const steps = chatGptGuideSteps({
    mode,
    endpointAvailable: options.endpointAvailable !== false,
    developerModeRequired: options.developerModeRequired !== false
  });
  guide.innerHTML = `
    <div class="chatgpt-guide-heading"><strong>${escapeHtml(title)}</strong><span>${mode === 'reconnect' ? 'Keep the existing app and endpoint.' : 'Create the app once, then reuse it.'}</span></div>
    <ol>${steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
    <div class="chatgpt-first-prompt"><span>Safe first request</span><code>${escapeHtml(chatGptFirstPrompt(options.workspaceAlias))}</code></div>`;
  return guide;
}
