import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = 39876;
const token = process.env.TEST_TOKEN ?? 'test-token-please-change';
// A fabricated value only used to confirm the removed secret-path no longer routes
// and that the diagnostic never echoes such a string.
const chatgptSecret = 'chatgpt-smoke-secret';
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-http-smoke-'));
const connectionProfile = path.join(stateDir, 'connection.json');
const originalProfile = `${JSON.stringify({ host: 'sentinel.invalid', port: 65535 }, null, 2)}\n`;
fs.writeFileSync(connectionProfile, originalProfile, 'utf8');

const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port), '--no-profile-write'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
    REL_AI_MCP_TOKEN: token,
    REL_AI_MCP_STATE_DIR: stateDir
  }
});

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

async function readMcpResponse(response) {
  const text = await response.text();
  if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
    const frames = text.split(/\n\n+/).map(frame => frame.trim()).filter(Boolean);
    const data = frames.flatMap(frame => frame.split(/\r?\n/))
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .filter(Boolean);
    if (!data.length) throw new Error(`MCP SSE response contained no data frame: ${text}`);
    return JSON.parse(data.at(-1));
  }
  return JSON.parse(text);
}

async function waitForHealth() {
  const url = `http://127.0.0.1:${port}/health`;
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) { if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] health wait:', error); }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`HTTP server did not become healthy. stderr:\n${stderr}`);
}

const health = await waitForHealth();
if (!health.ok || !health.transports.includes('streamable-http')) {
  throw new Error('health endpoint did not advertise streamable-http');
}

const smallGzipResponse = await fetch(`http://127.0.0.1:${port}/health`, {
  headers: { 'accept-encoding': 'gzip' }
});
if (smallGzipResponse.headers.get('content-encoding')) {
  throw new Error('small JSON responses should stay uncompressed below the gzip threshold');
}
await smallGzipResponse.json();

const compressedToolsResponse = await fetch(`http://127.0.0.1:${port}/api/tools?token=${encodeURIComponent(token)}`, {
  headers: { 'accept-encoding': 'gzip' }
});
if (compressedToolsResponse.headers.get('content-encoding') !== 'gzip') {
  throw new Error('large JSON responses should use gzip when the client accepts it');
}
const compressedTools = await compressedToolsResponse.json();
if (!Array.isArray(compressedTools) || compressedTools.length !== 20) {
  throw new Error('compressed tools API response was not decoded correctly');
}

const disabledGzipResponse = await fetch(`http://127.0.0.1:${port}/api/tools?token=${encodeURIComponent(token)}`, {
  headers: { 'accept-encoding': 'gzip;q=0' }
});
if (disabledGzipResponse.headers.get('content-encoding')) {
  throw new Error('gzip;q=0 must disable response compression');
}
await disabledGzipResponse.json();

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

const dashboardQueryAuth = await fetch(`http://127.0.0.1:${port}/api/dashboard/v10?token=${encodeURIComponent(token)}&requireHttpToken=0`).then((response) => response.json());
if (!dashboardQueryAuth.ok) {
  throw new Error(`dashboard API did not accept token query auth used by browser dashboard: ${JSON.stringify(dashboardQueryAuth)}`);
}
if (
  dashboardQueryAuth.application?.name !== 'Rel.AI MCP'
  || dashboardQueryAuth.application?.developer?.name !== 'Kyne'
  || dashboardQueryAuth.application?.developer?.username !== 'Kyne0328'
  || dashboardQueryAuth.application?.developer?.profileUrl !== 'https://github.com/Kyne0328'
  || dashboardQueryAuth.application?.repositoryUrl !== 'https://github.com/Kyne0328/rel-ai-mcp'
) {
  throw new Error(`dashboard API did not include canonical application attribution: ${JSON.stringify(dashboardQueryAuth.application)}`);
}

const invalidAsyncPost = await fetch(`http://127.0.0.1:${port}/api/settings?token=${encodeURIComponent(token)}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{invalid json'
});
const invalidAsyncPayload = await invalidAsyncPost.json();
if (
  invalidAsyncPost.status !== 400
  || invalidAsyncPayload.ok !== false
  || invalidAsyncPayload.errorCode !== 'request_invalid'
  || !invalidAsyncPayload.recovery?.message
) {
  throw new Error(`invalid JSON was not converted into a structured HTTP 400 response: ${JSON.stringify(invalidAsyncPayload)}`);
}
if (dashboardQueryAuth.readiness == null) {
  throw new Error('dashboard API did not include readiness data');
}
if (
  dashboardQueryAuth.connectionState?.localService?.status !== 'running'
  || !['available', 'disabled'].includes(dashboardQueryAuth.connectionState?.publicEndpoint?.status)
  || typeof dashboardQueryAuth.connectionState?.chatgptReadiness?.status !== 'string'
  || dashboardQueryAuth.connectionState?.dashboardUpdates?.status !== 'offline'
) {
  throw new Error(`dashboard API did not include the normalized desktop connection contract: ${JSON.stringify(dashboardQueryAuth.connectionState)}`);
}
const connectionResponse = await fetch(`http://127.0.0.1:${port}/api/connection?token=${encodeURIComponent(token)}`).then((response) => response.json());
const connectionText = JSON.stringify(connectionResponse);
if (connectionResponse.token !== 'set' || connectionText.includes(token) || connectionResponse.dashboardUrl.includes('token=') || connectionResponse.dashboardDataUrl.includes('token=')) {
  throw new Error(`connection API exposed a token-bearing value: ${connectionText}`);
}
if (!connectionResponse.chatgptAuthMode.includes('approval token')) {
  throw new Error('connection API did not use the canonical approval-token wording');
}

const diagnosticsResponse = await fetch(`http://127.0.0.1:${port}/api/diagnostics?token=${encodeURIComponent(token)}`).then((response) => response.json());
const diagnosticsText = JSON.stringify(diagnosticsResponse);
if (!diagnosticsResponse.ok || !diagnosticsResponse.reportText || !Array.isArray(diagnosticsResponse.findings) || diagnosticsText.includes(token) || diagnosticsText.includes(chatgptSecret)) {
  throw new Error(`diagnostics API was unavailable or leaked a secret: ${diagnosticsText}`);
}
if (diagnosticsResponse.logs?.runtime?.available !== false || diagnosticsResponse.maintenance?.runtimeLogs?.available !== false) {
  throw new Error('standalone diagnostics should identify desktop service logs as unavailable');
}

const invalidDiagnosticReset = await fetch(`http://127.0.0.1:${port}/api/diagnostics/reset?token=${encodeURIComponent(token)}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ target: 'invalid', confirm: true })
});
const invalidDiagnosticResetPayload = await invalidDiagnosticReset.json();
if (invalidDiagnosticReset.status !== 400 || invalidDiagnosticResetPayload.errorCode !== 'request_invalid' || !invalidDiagnosticResetPayload.recovery?.message) {
  throw new Error(`diagnostic reset validation was not structured: ${JSON.stringify(invalidDiagnosticResetPayload)}`);
}

const unconfirmedFullReset = await fetch(`http://127.0.0.1:${port}/api/diagnostics/reset?token=${encodeURIComponent(token)}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ target: 'all', confirm: true })
});
const unconfirmedFullResetPayload = await unconfirmedFullReset.json();
if (unconfirmedFullReset.status !== 400 || unconfirmedFullResetPayload.errorCode !== 'request_invalid') {
  throw new Error(`full diagnostic reset should require RESET confirmation: ${JSON.stringify(unconfirmedFullResetPayload)}`);
}

const runtimeReset = await fetch(`http://127.0.0.1:${port}/api/diagnostics/reset?token=${encodeURIComponent(token)}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ target: 'runtime_logs', confirm: true })
});
const runtimeResetPayload = await runtimeReset.json();
if (runtimeReset.status !== 409 || runtimeResetPayload.errorCode !== 'state_reset_failed') {
  throw new Error(`standalone runtime-log reset should be unavailable: ${JSON.stringify(runtimeResetPayload)}`);
}

if (dashboardQueryAuth.taskActivity?.state !== 'idle') {
  throw new Error('standalone dashboard API did not include the default idle task state');
}
if (!Array.isArray(dashboardQueryAuth.tasks) || typeof dashboardQueryAuth.workspaceStates !== 'object') {
  throw new TypeError('dashboard API did not include persistent tasks and operational workspace state');
}

const pathPreflight = await fetch(`http://127.0.0.1:${port}/api/workspace/preflight?token=${encodeURIComponent(token)}&path=${encodeURIComponent(root)}`).then((response) => response.json());
if (!pathPreflight.ok || !pathPreflight.exists || !pathPreflight.isDirectory) {
  throw new Error('workspace path preflight did not validate an existing directory');
}

const dashboardHtmlResponse = await fetch(`http://127.0.0.1:${port}/dashboard?token=${encodeURIComponent(token)}`);
const dashboardHtml = await dashboardHtmlResponse.text();
const dashboardCsp = dashboardHtmlResponse.headers.get('content-security-policy') || '';
if (!dashboardCsp.includes("default-src 'self'") || !dashboardCsp.includes("frame-ancestors 'none'")) {
  throw new Error(`dashboard response did not include the restrictive CSP: ${dashboardCsp}`);
}
if (!dashboardHtmlResponse.ok || dashboardHtml.includes('initialDashboardJson is not defined') || !dashboardHtml.includes('id="initialDashboardData"')) {
  throw new Error('dashboard HTML did not render embedded initial dashboard data');
}
if (!dashboardHtml.includes('id="commandPaletteBtn"') || !dashboardHtml.includes('id="connectionStatus"')) {
  throw new Error('dashboard HTML did not expose Quick navigation and connection status controls');
}
if (dashboardHtml.includes('id="refreshBtn"') || dashboardHtml.includes('id="workspaceScope"')) {
  throw new Error('dashboard topbar should not expose manual refresh or a global workspace selector');
}
if (dashboardHtml.includes('id="liveStatus"') || dashboardHtml.includes('id="serverStatus"')) {
  throw new Error('dashboard HTML should expose one canonical connection status control');
}
if (!dashboardHtml.includes('href="#tasks"') || !dashboardHtml.includes('href="#tools"')) {
  throw new Error('dashboard navigation did not include Sessions and Tools');
}
if (!dashboardHtml.includes('<title>Overview · Rel.AI MCP</title>')) {
  throw new Error('dashboard HTML did not include the route-specific initial title');
}
// The token field was removed from the topbar (token loads from the URL/sessionStorage).
if (dashboardHtml.includes('id="token"')) {
  throw new Error('dashboard topbar should no longer expose the token field');
}

const workspaceModule = await fetch(`http://127.0.0.1:${port}/ui/features/workspaces/index.js`).then((response) => response.text());
if (!workspaceModule.includes('mountWorkspaces') || workspaceModule.includes('Full workspace editor coming in Phase 2')) {
  throw new Error('workspace dashboard section is still incomplete or placeholder-only');
}
const tasksModule = await fetch(`http://127.0.0.1:${port}/ui/features/sessions/index.js`).then((response) => response.text());
if (!tasksModule.includes('mountTasks') || !tasksModule.includes('Session history') || !tasksModule.includes('completion was not reported')) {
  throw new Error('dashboard work-session section is missing or incomplete');
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

const initializeResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'relai-http-smoke', version: '1.0.0' } }
  })
});
const initialized = await readMcpResponse(initializeResponse);
if (!initialized.result?.capabilities?.tools) {
  throw new Error('HTTP initialize did not advertise tools');
}
if (!initialized.result?.capabilities?.resources) {
  throw new Error('HTTP initialize did not advertise resources');
}
if (initialized.result?.serverInfo?.toolSurfaceVersion !== 12 || initialized.result?.capabilities?.experimental?.relai?.manifestResource !== 'relai://server/tool-surface') {
  throw new Error('HTTP initialize did not advertise the versioned Rel.AI tool-surface manifest');
}
if (!String(initialized.result?.instructions || '').includes('relai_complete_task') || !String(initialized.result?.instructions || '').includes('complete:true')) {
  throw new Error('HTTP initialize did not advertise both explicit final-completion paths');
}

const list = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} })
}).then(readMcpResponse);
if (!Array.isArray(list.result?.tools) || list.result.tools.length !== 20) {
  throw new Error(`HTTP tools/list should return exactly 20 workspace tools, got ${list.result?.tools?.length}`);
}
const removedCompatibilityTools = ['relai_write', 'relai_replace', 'relai_browser', 'relai_restore_changes', 'relai_git_status', 'relai_git_create_pr'];
for (const name of removedCompatibilityTools) {
  if (list.result.tools.some(tool => tool.name === name)) throw new Error(`${name} must be absent from HTTP tools/list`);
}
const startTaskSchema = list.result.tools.find(tool => tool.name === 'relai_start_task');
if (!startTaskSchema || startTaskSchema.inputSchema?.properties?.task_id) {
  throw new Error('HTTP tools/list did not expose the task bootstrap contract correctly.');
}
const execSchema = list.result.tools.find(tool => tool.name === 'relai_exec');
if (!execSchema?.inputSchema?.properties?.command || !execSchema?.inputSchema?.properties?.cwd) {
  throw new Error('HTTP tools/list did not expose the relai_exec command contract.');
}
const editSchema = list.result.tools.find(tool => tool.name === 'relai_edit');
if (!editSchema?.inputSchema?.properties?.occurrence || !editSchema?.inputSchema?.properties?.replacements || !editSchema?.inputSchema?.properties?.edits?.items?.properties?.replacements) {
  throw new Error('HTTP tools/list did not expose full exact-replacement parity through relai_edit.');
}
if (JSON.stringify(editSchema.inputSchema.properties.stage?.enum) !== JSON.stringify(['start', 'append', 'commit', 'abort'])) {
  throw new Error('HTTP tools/list did not expose bounded staged edit operations.');
}
const searchSchema = list.result.tools.find(tool => tool.name === 'relai_search');
if (!searchSchema?.inputSchema?.properties?.contextBefore || !searchSchema?.inputSchema?.properties?.maxBytes) {
  throw new Error('HTTP tools/list did not expose contextual relai_search options.');
}
if (JSON.stringify(searchSchema.inputSchema.properties.mode?.enum) !== JSON.stringify(['auto', 'compact', 'context'])) {
  throw new Error('HTTP tools/list did not expose adaptive relai_search mode as the default-capable contract.');
}
const codeInspectSchema = list.result.tools.find(tool => tool.name === 'relai_code_inspect');
if (JSON.stringify(codeInspectSchema?.inputSchema?.properties?.action?.enum) !== JSON.stringify(['symbol', 'references', 'related', 'impact', 'diagnostics']) || codeInspectSchema?.annotations?.readOnlyHint !== true) {
  throw new Error('HTTP tools/list did not expose the bounded read-only code-intelligence contract.');
}
const runChecksSchema = list.result.tools.find(tool => tool.name === 'relai_run_checks');
if (!runChecksSchema?.inputSchema?.properties?.complete || runChecksSchema?.inputSchema?.properties?.summary?.maxLength !== 2000) {
  throw new Error('HTTP tools/list did not expose atomic validation completion fields.');
}
const httpProbeSchema = list.result.tools.find(tool => tool.name === 'relai_http_probe');
if (!httpProbeSchema?.inputSchema?.properties?.route || httpProbeSchema.inputSchema.properties.url) {
  throw new Error('HTTP tools/list did not expose the route-only relai_http_probe contract.');
}
const uiCheckSchema = list.result.tools.find(tool => tool.name === 'relai_ui_check');
if (!uiCheckSchema?.inputSchema?.properties?.check || uiCheckSchema.inputSchema.properties.command) {
  throw new Error('HTTP tools/list did not expose the named-script relai_ui_check contract.');
}
const restorePathsSchema = list.result.tools.find(tool => tool.name === 'relai_restore_paths');
if (!restorePathsSchema?.inputSchema?.properties?.paths || restorePathsSchema.inputSchema.properties.clean) {
  throw new Error('HTTP tools/list did not expose the tracked-path-only relai_restore_paths contract.');
}
const resetWorkspaceSchema = list.result.tools.find(tool => tool.name === 'relai_reset_workspace');
if (JSON.stringify(resetWorkspaceSchema?.inputSchema?.properties?.confirmation?.enum) !== JSON.stringify(['RESET', 'RESET_AND_CLEAN'])) {
  throw new Error('HTTP tools/list did not expose explicit workspace-reset confirmations.');
}
const statusSchema = list.result.tools.find(tool => tool.name === 'relai_status');
if (!statusSchema?.inputSchema?.properties?.maxBytes || !/workspace\.repository/.test(statusSchema?.description || '')) {
  throw new Error('HTTP tools/list did not expose repository state through relai_status.');
}
const draftPrSchema = list.result.tools.find(tool => tool.name === 'relai_git_draft_pr');
if (!/does not call a hosting provider/.test(draftPrSchema?.description || '') || draftPrSchema?.annotations?.openWorldHint !== false) {
  throw new Error('HTTP tools/list did not expose the local-only relai_git_draft_pr contract.');
}
const resources = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'resources/list', params: {} })
}).then(readMcpResponse);
if (!Array.isArray(resources.result?.resources) || !resources.result.resources.some((item) => item.uri === 'relai://server/workspaces')) {
  throw new Error('HTTP resources/list did not expose workspace resource');
}
if (!resources.result.resources.some((item) => item.uri === 'relai://server/tool-surface')) {
  throw new Error('HTTP resources/list did not expose the tool-surface manifest resource');
}
const toolSurfaceResource = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 41, method: 'resources/read', params: { uri: 'relai://server/tool-surface' } })
}).then(readMcpResponse);
const toolSurfaceManifest = JSON.parse(toolSurfaceResource.result?.contents?.[0]?.text || '{}');
if (toolSurfaceManifest.toolSurfaceVersion !== 12 || toolSurfaceManifest.toolCount !== 20 || !Array.isArray(toolSurfaceManifest.deprecations) || toolSurfaceManifest.deprecations.length !== 0) {
  throw new Error(`tool-surface resource returned an invalid manifest: ${JSON.stringify(toolSurfaceManifest)}`);
}

const removedConfigTool = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'relai_config', arguments: {} } })
}).then(readMcpResponse);
if (removedConfigTool.error?.code !== -32602) {
  throw new Error(`HTTP relai_config should be rejected by the SDK tool registry: ${JSON.stringify(removedConfigTool)}`);
}

child.kill('SIGKILL');
await once(child, 'close');
if (fs.readFileSync(connectionProfile, 'utf8') !== originalProfile) {
  throw new Error('HTTP smoke test rewrote the isolated connector profile despite --no-profile-write.');
}
fs.rmSync(stateDir, { recursive: true, force: true });
console.log(`HTTP smoke test passed. Workspace tools: ${list.result.tools.length}`);
