import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = 39876;
const token = process.env.TEST_TOKEN ?? 'test-token-please-change';
const chatgptSecret = 'chatgpt-smoke-secret';

const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
    REL_AI_MCP_TOKEN: token,
    REL_AI_MCP_CHATGPT_SECRET: chatgptSecret
  }
});

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

async function waitForHealth() {
  const url = `http://127.0.0.1:${port}/health`;
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (_error) {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`HTTP server did not become healthy. stderr:\n${stderr}`);
}

const health = await waitForHealth();
if (!health.ok || !health.transports.includes('streamable-http')) {
  throw new Error('health endpoint did not advertise streamable-http');
}

const mcpBrowserDiagnostic = await fetch(`http://127.0.0.1:${port}/mcp`).then((response) => response.json());
if (!mcpBrowserDiagnostic.ok || !mcpBrowserDiagnostic.postRequired || !mcpBrowserDiagnostic.correctChatGPTUrl.includes(`/mcp/${chatgptSecret}`)) {
  throw new Error('GET /mcp did not return the browser diagnostic with the correct ChatGPT URL');
}

const secretBrowserDiagnostic = await fetch(`http://127.0.0.1:${port}/mcp/${chatgptSecret}`).then((response) => response.json());
if (!secretBrowserDiagnostic.ok || secretBrowserDiagnostic.chatgptAuth !== 'No Authentication' || !secretBrowserDiagnostic.usableWithPost) {
  throw new Error('GET /mcp/<secret> did not return a usable ChatGPT diagnostic');
}

const dashboardQueryAuth = await fetch(`http://127.0.0.1:${port}/api/dashboard/v10?token=${encodeURIComponent(token)}&requireHttpToken=0`).then((response) => response.json());
if (!dashboardQueryAuth.ok) {
  throw new Error('dashboard API did not accept token query auth used by browser dashboard');
}
if (dashboardQueryAuth.readiness == null) {
  throw new Error('dashboard API did not include readiness data');
}

const dashboardHtmlResponse = await fetch(`http://127.0.0.1:${port}/dashboard?token=${encodeURIComponent(token)}`);
const dashboardHtml = await dashboardHtmlResponse.text();
if (!dashboardHtmlResponse.ok || dashboardHtml.includes('initialDashboardJson is not defined') || !dashboardHtml.includes('id="initialDashboardData"')) {
  throw new Error('dashboard HTML did not render embedded initial dashboard data');
}
if (!dashboardHtml.includes('id="refreshBtn"')) {
  throw new Error('dashboard HTML did not expose the wired refresh button');
}

const autoApproveSettings = await fetch(`http://127.0.0.1:${port}/api/auto-approve/settings?token=${encodeURIComponent(token)}`).then((response) => response.json());
if (!autoApproveSettings.ok || autoApproveSettings.enabled !== false || autoApproveSettings.mode !== 'chrome_extension' || !autoApproveSettings.warning.includes('Chrome extension')) {
  throw new Error('auto-approve settings endpoint did not expose the disabled extension-only warning state');
}

const removedUserscript = await fetch(`http://127.0.0.1:${port}/userscripts/chatgpt-auto-approve.user.js?token=${encodeURIComponent(token)}`);
if (removedUserscript.status !== 404) {
  throw new Error('removed userscript endpoint should not be served');
}

const extensionManifestResponse = await fetch(`http://127.0.0.1:${port}/public/extensions/chrome-auto-approve/manifest.json`);
const extensionManifest = await extensionManifestResponse.text();
if (!extensionManifestResponse.ok || !extensionManifest.includes('Rel.AI MCP Auto-Approve') || !extensionManifest.includes('Kyne0328')) {
  throw new Error('auto-approve extension manifest was not served');
}

const extensionDocs = await fetch(`http://127.0.0.1:${port}/public/docs/AUTO_APPROVE_EXTENSION.md`).then((response) => response.text());
if (!extensionDocs.includes('Required double opt-in')) {
  throw new Error('auto-approve extension docs were not served');
}

const workspaceModule = await fetch(`http://127.0.0.1:${port}/ui/sections/workspaces.js`).then((response) => response.text());
if (!workspaceModule.includes('mountWorkspaces') || workspaceModule.includes('Full workspace editor coming in Phase 2')) {
  throw new Error('workspace dashboard section is still incomplete or placeholder-only');
}

const unauthorized = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
});
if (unauthorized.status !== 401) {
  throw new Error(`expected unauthorized status 401, got ${unauthorized.status}`);
}


const chatgptList = await fetch(`http://127.0.0.1:${port}/mcp/${chatgptSecret}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 30, method: 'tools/list', params: {} })
}).then((response) => response.json());
if (!Array.isArray(chatgptList.result?.tools) || chatgptList.result.tools.length !== 7 || !chatgptList.result.tools.some((item) => item.name === 'relai_repo_snapshot')) {
  throw new Error('secret ChatGPT MCP URL did not expose exactly the bridge tools without bearer auth');
}

const initialized = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
}).then((response) => response.json());
if (!initialized.result?.capabilities?.tools) {
  throw new Error('HTTP initialize did not advertise tools');
}
if (!initialized.result?.capabilities?.resources) {
  throw new Error('HTTP initialize did not advertise resources');
}

const list = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} })
}).then((response) => response.json());
if (!Array.isArray(list.result?.tools) || list.result.tools.length !== 7) {
  throw new Error(`HTTP tools/list should return exactly 7 bridge tools, got ${list.result?.tools?.length}`);
}

const resources = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'resources/list', params: {} })
}).then((response) => response.json());
if (!Array.isArray(resources.result?.resources) || !resources.result.resources.some((item) => item.uri === 'relai://server/workspaces')) {
  throw new Error('HTTP resources/list did not expose workspace resource');
}

const removedConfigTool = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'relai_config', arguments: {} } })
}).then((response) => response.json());
if (!removedConfigTool.result?.isError) {
  throw new Error('HTTP relai_config should be rejected because only bridge tools are MCP tools');
}

child.kill('SIGKILL');
await once(child, 'close');
console.log(`HTTP smoke test passed. Tools: ${list.result.tools.length}`);
