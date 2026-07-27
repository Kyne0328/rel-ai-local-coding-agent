import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

export function startMcpClient({ root, configPath, env = {}, timeoutMs = 5000 }) {
  const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp.js')], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env, REL_AI_MCP_CONFIG: configPath }
  });
  const responses = new Map();
  const waiters = new Map();
  let buffer = '';
  let stderr = '';
  let closed = false;

  child.stdout.on('data', chunk => {
    buffer += chunk.toString('utf8');
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      const waiter = waiters.get(response.id);
      if (waiter) {
        waiters.delete(response.id);
        clearTimeout(waiter.timer);
        waiter.resolve(response);
      } else {
        responses.set(response.id, response);
      }
    }
  });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  child.once('close', code => {
    closed = true;
    for (const [id, waiter] of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`MCP process closed with exit ${code} before response ${id}. stderr:\n${stderr}`));
    }
    waiters.clear();
  });

  function send(id, method, params = {}) {
    if (closed) throw new Error(`Cannot send ${method}; MCP process is closed.`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  }

  function notify(method, params = {}) {
    if (closed) throw new Error(`Cannot send ${method}; MCP process is closed.`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  function call(id, name, args = {}) {
    send(id, 'tools/call', { name, arguments: args });
  }

  function waitFor(id, waitTimeoutMs = timeoutMs) {
    if (responses.has(id)) {
      const response = responses.get(id);
      responses.delete(id);
      return Promise.resolve(response);
    }
    if (closed) return Promise.reject(new Error(`MCP process closed before response ${id}. stderr:\n${stderr}`));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(id);
        reject(new Error(`Timed out waiting for response ${id}. stderr:\n${stderr}`));
      }, waitTimeoutMs);
      waiters.set(id, { resolve, reject, timer });
    });
  }

  async function close() {
    if (!closed) {
      child.stdin.end();
      child.kill('SIGTERM');
      await once(child, 'close').catch(() => {});
    }
  }

  return { send, notify, call, waitFor, close };
}

export function structuredContentOf(response) {
  const payload = response?.result?.structuredContent;
  if (!payload || payload.ok === false) throw new Error(JSON.stringify(payload || response));
  return payload;
}
