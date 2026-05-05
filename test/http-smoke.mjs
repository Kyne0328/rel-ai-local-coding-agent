import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = 39876;
const token = 'test-token-please-change';

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

const unauthorized = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
});
if (unauthorized.status !== 401) {
  throw new Error(`expected unauthorized status 401, got ${unauthorized.status}`);
}

const initialized = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
}).then((response) => response.json());
if (!initialized.result?.capabilities?.tools) {
  throw new Error('HTTP initialize did not advertise tools');
}

const list = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} })
}).then((response) => response.json());
if (!Array.isArray(list.result?.tools) || list.result.tools.length < 5) {
  throw new Error('HTTP tools/list returned too few tools');
}

const config = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'relai_config', arguments: {} } })
}).then((response) => response.json());
if (!config.result?.structuredContent?.ok) {
  throw new Error('HTTP relai_config did not return ok');
}

child.kill('SIGTERM');
await once(child, 'close');
console.log(`HTTP smoke test passed. Tools: ${list.result.tools.length}`);
