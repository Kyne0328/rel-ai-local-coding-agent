import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp.js')], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json')
  }
});

let buffer = '';
const responses = [];
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) responses.push(JSON.parse(line));
  }
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function waitFor(id, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = responses.find((item) => item.id === id);
      if (found) {
        clearInterval(timer);
        resolve(found);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for response id ${id}. stderr may contain details.`));
      }
    }, 25);
  });
}

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
const init = await waitFor(1);
if (!init.result?.capabilities?.tools) throw new Error('initialize did not advertise tools capability');
if (!init.result?.capabilities?.resources) throw new Error('initialize did not advertise resources capability');

send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
const list = await waitFor(2);
if (!Array.isArray(list.result?.tools) || list.result.tools.length < 5) {
  throw new Error('tools/list returned too few tools');
}
const editTool = list.result.tools.find((item) => item.name === 'relai_edit_file');
if (!editTool) throw new Error('tools/list did not expose relai_edit_file');
if (!editTool.inputSchema?.properties?.edits) throw new Error('relai_edit_file schema did not expose edits');

send({ jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} });
const resources = await waitFor(3);
if (!Array.isArray(resources.result?.resources) || !resources.result.resources.some((item) => item.uri === 'relai://server/workspaces')) {
  throw new Error('resources/list did not expose workspace resource');
}

send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'relai_config', arguments: {} } });
const config = await waitFor(4);
if (!config.result?.structuredContent?.ok) throw new Error('relai_config did not return ok');

child.stdin.end();
child.kill('SIGTERM');
await once(child, 'close');
console.log(`Smoke test passed. Tools: ${list.result.tools.length}`);
