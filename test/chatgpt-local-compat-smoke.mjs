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
  if (names.length !== 8) throw new Error(`Expected 8 visible bridge tools, got ${names.length}`);
  if (names.includes('relai_read_files')) throw new Error('compatibility tool leaked into tools/list');

  send(3, 'tools/call', { name: 'relai_read_files', arguments: { workspace: 'repo', paths: ['package.json'] } });
  const read = await waitFor(3);
  if (read.result.isError) throw new Error(`relai_read_files should remain callable in local repo mode: ${read.result.content[0].text}`);

  send(4, 'tools/call', { name: 'relai_run_test', arguments: { workspace: 'repo', command: 'node --version' } });
  const test = await waitFor(4);
  if (test.result.isError) throw new Error(`relai_run_test should remain callable in local repo mode: ${test.result.content[0].text}`);

  send(5, 'tools/call', { name: 'relai_write_file', arguments: { workspace: 'repo', path: 'tmp-relai-compat.txt', content: 'compat write ok\n' } });
  const write = await waitFor(5);
  if (write.result.isError) throw new Error(`relai_write_file should remain callable as a hidden compatibility alias: ${write.result.content[0].text}`);

  send(6, 'tools/call', { name: 'relai_shell', arguments: { workspace: 'repo', command: 'node --version' } });
  const shell = await waitFor(6);
  if (shell.result.isError) throw new Error(`relai_shell should be unrestricted in trusted local mode: ${shell.result.content[0].text}`);
  fs.rmSync(path.join(root, 'tmp-relai-compat.txt'), { force: true });

  console.log('ChatGPT local compatibility smoke test passed.');
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
  await once(child, 'close').catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}
