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
      path: root
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
  if (names.length !== 14) throw new Error(`Expected 14 visible bridge tools, got ${names.length}`);
  for (const required of ['relai_apply_update', 'relai_apply_bundle', 'relai_package_snapshot', 'relai_status', 'relai_feature_probe']) {
    if (!names.includes(required)) throw new Error(`missing fast tool ${required}`);
  }

  send(3, 'tools/call', { name: 'relai_write', arguments: { workspace: 'repo', path: 'tmp-relai-bridge.txt', content: 'bridge write ok\n' } });
  const write = await waitFor(3);
  if (write.result.isError) throw new Error(`relai_write should be callable in local repo mode: ${write.result.content[0].text}`);

  send(31, 'tools/call', { name: 'relai_write', arguments: { workspace: 'repo', edits: [{ path: 'tmp-relai-bridge.txt', find: 'x', replace: 'y' }] } });
  const editWrite = await waitFor(31);
  if (!editWrite.result.isError) throw new Error('relai_write must reject edit-array payloads');



  fs.writeFileSync(path.join(root, 'tmp-relai-replace.txt'), 'alpha\nbeta\n');
  send(32, 'tools/call', { name: 'relai_replace', arguments: { workspace: 'repo', path: 'tmp-relai-replace.txt', oldText: 'beta\n', newText: 'gamma\n' } });
  const replace = await waitFor(32);
  if (replace.result.isError) throw new Error(`relai_replace should be callable: ${replace.result.content[0].text}`);
  if (fs.readFileSync(path.join(root, 'tmp-relai-replace.txt'), 'utf8') !== 'alpha\ngamma\n') throw new Error('relai_replace did not apply exact replacement');

  send(33, 'tools/call', { name: 'relai_clear_files', arguments: { workspace: 'repo', path: 'tmp-relai-replace.txt' } });
  const del = await waitFor(33);
  if (del.result.isError) throw new Error(`relai_clear_files should be callable: ${del.result.content[0].text}`);
  if (fs.existsSync(path.join(root, 'tmp-relai-replace.txt'))) throw new Error('relai_clear_files did not clear file');

  send(4, 'tools/call', { name: 'relai_shell', arguments: { workspace: 'repo', command: 'node --version' } });
  const shell = await waitFor(4);
  if (!shell.result.isError) throw new Error('removed relai_shell should be rejected');
  if (!/Unknown tool/.test(shell.result.content[0].text)) throw new Error('removed tool should return Unknown tool');

  send(5, 'tools/call', { name: 'relai_apply_update', arguments: { workspace: 'repo', updateText: 'bad patch' } });
  const patch = await waitFor(5);
  if (!patch.result.isError) throw new Error('relai_apply_update should reject malformed update text');


  send(6, 'tools/call', { name: 'relai_read_files', arguments: { workspace: 'repo', paths: ['package.json'] } });
  const readFiles = await waitFor(6);
  if (!readFiles.result.isError) throw new Error('removed relai_read_files should be rejected');
  if (!/Unknown tool/.test(readFiles.result.content[0].text)) throw new Error('removed read_files tool should return Unknown tool');

  send(7, 'tools/call', { name: 'relai_version', arguments: {} });
  const version = await waitFor(7);
  if (!version.result.isError) throw new Error('removed relai_version MCP tool should be rejected; use /health instead');
  if (!/Unknown tool/.test(version.result.content[0].text)) throw new Error('removed version tool should return Unknown tool');

  fs.rmSync(path.join(root, 'tmp-relai-bridge.txt'), { force: true });
  fs.rmSync(path.join(root, 'tmp-relai-replace.txt'), { force: true });

  console.log('ChatGPT local single-workflow smoke test passed; removed tools are rejected.');
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
  await once(child, 'close').catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}
