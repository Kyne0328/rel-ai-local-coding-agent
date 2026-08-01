import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY
} from '@modelcontextprotocol/server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-stdio-modern-rejection-'));
const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp.js')], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
    REL_AI_MCP_STATE_DIR: stateDir
  }
});
let buffer = '';
let stderr = '';
const messages = [];
const waiters = [];

child.stdout.on('data', chunk => {
  buffer += chunk.toString('utf8');
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const value = JSON.parse(line);
    const waiter = waiters.shift();
    if (waiter) waiter(value);
    else messages.push(value);
  }
});
child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });

function nextMessage(timeoutMs = 5000) {
  if (messages.length) return Promise.resolve(messages.shift());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for stdio response. ${stderr}`)), timeoutMs);
    waiters.push(value => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function write(value) {
  child.stdin.write(`${JSON.stringify(value)}\n`);
}

try {
  write({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'legacy-client', version: '1.0.0' }
    }
  });
  const legacy = await nextMessage();
  assert.equal(legacy.id, 1);
  assert.equal(legacy.error?.code, -32022);
  assert.deepEqual(legacy.error?.data?.supported, ['2026-07-28']);

  write({
    jsonrpc: '2.0',
    id: 2,
    method: 'server/discover',
    params: {
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
        [CLIENT_INFO_META_KEY]: { name: 'modern-client', version: '1.0.0' },
        [CLIENT_CAPABILITIES_META_KEY]: {}
      }
    }
  });
  const modern = await nextMessage();
  assert.equal(modern.id, 2);
  assert.deepEqual(modern.result?.supportedVersions, ['2026-07-28']);
  assert.equal(modern.result?.resultType, 'complete');
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
  await once(child, 'close').catch(() => {});
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('stdio rejects legacy initialize and remains available for MCP 2026-07-28 discovery.');
