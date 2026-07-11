import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-single-surface-'));
const configPath = path.join(temp, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({
  version: 2,
  stateDir: path.join(temp, 'state'),
  patch: { backup: false, requireCleanGit: false, maxUpdateBytes: 2097152 },
  workspaces: { repo: { path: root } }
}, null, 2));

const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp.js')], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, REL_AI_MCP_CONFIG: configPath }
});
const responses = [];
let buffer = '';
child.stdout.on('data', chunk => {
  buffer += chunk.toString('utf8');
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
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
      const response = responses.find(item => item.id === id);
      if (response) {
        clearInterval(timer);
        resolve(response);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for response ${id}.`));
      }
    }, 25);
  });
}

try {
  send(1, 'initialize', { protocolVersion: '2025-06-18' });
  await waitFor(1);
  send(2, 'tools/list');
  const list = await waitFor(2);
  const names = list.result.tools.map(tool => tool.name);
  assert.equal(names.length, 17);
  for (const required of ['relai_edit', 'relai_write', 'relai_replace', 'relai_status', 'relai_git_status', 'relai_git_commit', 'relai_git_push', 'relai_git_create_pr', 'relai_complete_task']) {
    assert.ok(names.includes(required), `missing active tool ${required}`);
  }
  for (const removed of ['relai_apply_bundle', 'relai_package_snapshot', 'relai_apply_update', 'relai_clear_files', 'relai_feature_probe', 'relai_git_fetch', 'relai_session_summary']) {
    assert.equal(names.includes(removed), false, `${removed} must not be listed`);
    send(100 + names.length + removed.length, 'tools/call', { name: removed, arguments: { workspace: 'repo' } });
    const response = await waitFor(100 + names.length + removed.length);
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /Unknown tool/);
  }

  send(3, 'tools/call', { name: 'relai_status', arguments: { workspace: 'repo' } });
  const status = await waitFor(3);
  assert.equal(status.result.isError, false);
  const payload = JSON.parse(status.result.content[0].text);
  assert.equal(payload.tools.length, 17);
  assert.equal(Object.hasOwn(payload.toolGroups || {}, 'internal'), false);

  console.log('Single 17-tool MCP surface smoke test passed.');
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
  await once(child, 'close').catch(() => {});
  fs.rmSync(temp, { recursive: true, force: true });
}
