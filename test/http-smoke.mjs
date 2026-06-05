import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = 39876;
const token = process.env.TEST_TOKEN ?? 'test-token-please-change';
// A fabricated value only used to confirm the removed secret-path no longer routes
// and that the diagnostic never echoes such a string.
const chatgptSecret = 'chatgpt-smoke-secret';

const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
    REL_AI_MCP_TOKEN: token
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
const publicDiagnosticText = JSON.stringify(mcpBrowserDiagnostic);
if (!mcpBrowserDiagnostic.ok || !mcpBrowserDiagnostic.postRequired || mcpBrowserDiagnostic.chatgptAuth !== 'OAuth' || !mcpBrowserDiagnostic.correctChatGPTUrl.endsWith('/mcp') || !mcpBrowserDiagnostic.oauthProtectedResource.includes('/.well-known/oauth-protected-resource') || publicDiagnosticText.includes(chatgptSecret) || publicDiagnosticText.includes(token)) {
  throw new Error('GET /mcp did not return an OAuth diagnostic without leaking secrets');
}

// The legacy secret-path is removed: /mcp/<secret> is no longer a special route.
const removedSecretRoute = await fetch(`http://127.0.0.1:${port}/mcp/${chatgptSecret}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} })
});
if (removedSecretRoute.status !== 401 && removedSecretRoute.status !== 404) {
  throw new Error(`legacy /mcp/<secret> path should no longer authenticate; got ${removedSecretRoute.status}`);
}

const publicLocalConnect = await fetch(`http://127.0.0.1:${port}/api/local-connect`).then((response) => response.json());
if (publicLocalConnect.token || publicLocalConnect.tokenAvailable || !publicLocalConnect.requiresAuthorization) {
  throw new Error('GET /api/local-connect should not expose the bearer token without authorization');
}

const authorizedLocalConnect = await fetch(`http://127.0.0.1:${port}/api/local-connect`, { headers: { authorization: `Bearer ${token}` } }).then((response) => response.json());
if (authorizedLocalConnect.token !== token || authorizedLocalConnect.requiresAuthorization) {
  throw new Error('GET /api/local-connect did not return the token to an authorized caller');
}

const dashboardQueryAuth = await fetch(`http://127.0.0.1:${port}/api/dashboard/v10?token=${encodeURIComponent(token)}&requireHttpToken=0`).then((response) => response.json());
if (!dashboardQueryAuth.ok) {
  throw new Error('dashboard API did not accept token query auth used by browser dashboard');
}
if (dashboardQueryAuth.readiness == null) {
  throw new Error('dashboard API did not include readiness data');
}

const pathPreflight = await fetch(`http://127.0.0.1:${port}/api/workspace/preflight?token=${encodeURIComponent(token)}&path=${encodeURIComponent(root)}`).then((response) => response.json());
if (!pathPreflight.ok || !pathPreflight.exists || !pathPreflight.isDirectory) {
  throw new Error('workspace path preflight did not validate an existing directory');
}

const dashboardHtmlResponse = await fetch(`http://127.0.0.1:${port}/dashboard?token=${encodeURIComponent(token)}`);
const dashboardHtml = await dashboardHtmlResponse.text();
if (!dashboardHtmlResponse.ok || dashboardHtml.includes('initialDashboardJson is not defined') || !dashboardHtml.includes('id="initialDashboardData"')) {
  throw new Error('dashboard HTML did not render embedded initial dashboard data');
}
if (!dashboardHtml.includes('id="liveBtn"') || !dashboardHtml.includes('id="refreshBtn"')) {
  throw new Error('dashboard HTML did not expose the wired live toggle and refresh button');
}
// The token field was removed from the topbar (token loads from the URL/sessionStorage).
if (dashboardHtml.includes('id="token"')) {
  throw new Error('dashboard topbar should no longer expose the token field');
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
if (!extensionDocs.includes('Enable/disable control')) {
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


// Unauthenticated POST /mcp returns the OAuth challenge so ChatGPT starts the flow.
const oauthChallenge = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 30, method: 'tools/list', params: {} })
});
const challengeHeader = oauthChallenge.headers.get('www-authenticate') || '';
if (oauthChallenge.status !== 401 || !/Bearer/i.test(challengeHeader) || !challengeHeader.includes('resource_metadata=')) {
  throw new Error(`POST /mcp without auth did not return a Bearer resource_metadata challenge: ${oauthChallenge.status} ${challengeHeader}`);
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
if (!Array.isArray(list.result?.tools) || list.result.tools.length !== 24) {
  throw new Error(`HTTP tools/list should return exactly 24 workspace tools, got ${list.result?.tools?.length}`);
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
console.log(`HTTP smoke test passed. Workspace tools: ${list.result.tools.length}`);
