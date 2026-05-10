import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-local-compat-'));
const configPath = path.join(tmp, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({
  version: 1,
  stateDir: path.join(tmp, 'state'),
  toolMode: 'chatgpt_local_repo',
  trustedLocalAgent: true,
  workspaces: {
    repo: {
      path: root,
      allowArbitraryCommands: true,
      allowDestructiveTools: true
    }
  }
}, null, 2));

const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp.js')], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, REL_AI_MCP_CONFIG: configPath }
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

function send(id, method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
}

function waitFor(id, timeoutMs = 5000) {
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
        reject(new Error(`Timed out waiting for response id ${id}.`));
      }
    }, 25);
  });
}

try {
  send(1, 'initialize');
  await waitFor(1);

  send(2, 'tools/list');
  const list = await waitFor(2);
  const names = list.result.tools.map((tool) => tool.name);
  if (names.length !== 7) throw new Error(`Expected 7 visible bridge tools, got ${names.length}`);

  send(3, 'tools/call', { name: 'relai_write', arguments: { workspace: 'repo', edits: [{ op: 'writeFile', path: 'tmp-relai-bridge.txt', content: 'bridge write ok\n' }] } });
  const write = await waitFor(3);
  if (write.result.isError) throw new Error(`relai_write should be callable in local repo mode: ${write.result.content[0].text}`);

  send(4, 'tools/call', { name: 'relai_shell', arguments: { workspace: 'repo', command: 'node --version' } });
  const shell = await waitFor(4);
  if (!shell.result.isError) throw new Error('removed relai_shell should be rejected');
  if (!/Unknown tool/.test(shell.result.content[0].text)) throw new Error('removed tool should return Unknown tool');

  send(5, 'tools/call', { name: 'relai_apply_patch', arguments: { workspace: 'repo', diff: 'bad patch' } });
  const patch = await waitFor(5);
  if (!patch.result.isError) throw new Error('removed relai_apply_patch should be rejected');
  if (!/Unknown tool/.test(patch.result.content[0].text)) throw new Error('removed patch tool should return Unknown tool');

  fs.rmSync(path.join(root, 'tmp-relai-bridge.txt'), { force: true });

  console.log('ChatGPT local single-workflow smoke test passed; removed tools are rejected.');
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
  await once(child, 'close').catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}
