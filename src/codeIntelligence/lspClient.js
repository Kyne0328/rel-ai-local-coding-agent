import { spawn } from 'node:child_process';

import { terminateProcessTree } from '../process.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_STDERR_BYTES = 32 * 1024;

class LspClient {
  constructor({ executable, argv = [], cwd, env = process.env, name = 'language-server', requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }) {
    this.executable = executable;
    this.argv = argv;
    this.cwd = cwd;
    this.env = env;
    this.name = name;
    this.requestTimeoutMs = requestTimeoutMs;
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = new Map();
    this.stderr = '';
    this.closed = false;
  }

  async start() {
    if (this.child && !this.closed) return this;
    this.closed = false;
    this.child = spawn(this.executable, this.argv, {
      cwd: this.cwd,
      env: this.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.child.stdout.on('data', chunk => this.onData(chunk));
    this.child.stderr.on('data', chunk => {
      this.stderr = (this.stderr + chunk.toString('utf8')).slice(-MAX_STDERR_BYTES);
    });
    this.child.once('error', error => this.failAll(error));
    this.child.once('exit', (code, signal) => {
      const suffix = signal ? ` signal ${signal}` : ` code ${code ?? 'unknown'}`;
      this.failAll(new Error(`${this.name} exited with${suffix}.`));
    });
    await new Promise((resolve, reject) => {
      const child = this.child;
      const onSpawn = () => finish(resolve);
      const onError = error => finish(() => reject(error));
      const timer = setTimeout(() => finish(() => reject(new Error(`${this.name} did not start in time.`))), 5_000);
      timer.unref?.();
      const finish = action => {
        clearTimeout(timer);
        child.off('spawn', onSpawn);
        child.off('error', onError);
        if (typeof action === 'function') action();
        else action?.();
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
    return this;
  }

  request(method, params, options = {}) {
    if (!this.child || this.closed) return Promise.reject(new Error(`${this.name} is not running.`));
    const id = this.nextId++;
    const timeoutMs = Number(options.timeoutMs || this.requestTimeoutMs);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name} request timed out: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      const signal = options.signal;
      const onAbort = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        try { this.notify('$/cancelRequest', { id }); } catch {}
        const error = new Error(`Cancelled ${this.name} request: ${method}`);
        error.name = 'AbortError';
        reject(error);
      };
      signal?.addEventListener?.('abort', onAbort, { once: true });
      this.pending.set(id, {
        resolve: value => {
          clearTimeout(timer);
          signal?.removeEventListener?.('abort', onAbort);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timer);
          signal?.removeEventListener?.('abort', onAbort);
          reject(error);
        }
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    if (!this.child || this.closed) return;
    this.send({ jsonrpc: '2.0', method, params });
  }

  onNotification(method, listener) {
    if (!this.notifications.has(method)) this.notifications.set(method, new Set());
    this.notifications.get(method).add(listener);
    return () => this.notifications.get(method)?.delete(listener);
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    if (!this.closed) {
      try { await this.request('shutdown', null, { timeoutMs: 2_000 }); } catch {}
      try { this.notify('exit', null); } catch {}
    }
    this.closed = true;
    this.child = null;
    await terminateProcessTree(child, { graceMs: 1_000, forceWaitMs: 1_000 }).catch(() => {});
    this.failAll(new Error(`${this.name} stopped.`));
  }

  send(message) {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii');
    this.child.stdin.write(Buffer.concat([header, body]));
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const match = header.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      let message;
      try { message = JSON.parse(body); } catch { continue; }
      this.dispatch(message);
    }
  }

  dispatch(message) {
    if (message && Object.hasOwn(message, 'id') && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        const error = new Error(String(message.error.message || `${this.name} request failed.`));
        error.code = String(message.error.code ?? 'LSP_REQUEST_FAILED');
        pending.reject(error);
      } else pending.resolve(message.result);
      return;
    }
    if (!message?.method) return;
    for (const listener of this.notifications.get(message.method) || []) {
      try { listener(message.params); } catch {}
    }
    if (Object.hasOwn(message, 'id')) {
      this.send({ jsonrpc: '2.0', id: message.id, result: clientRequestResult(message.method, message.params) });
    }
  }

  failAll(error) {
    if (this.closed && this.pending.size === 0) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function clientRequestResult(method, params = {}) {
  if (method === 'workspace/configuration') {
    return Array.isArray(params?.items) ? params.items.map(() => null) : [];
  }
  if (method === 'workspace/applyEdit') {
    return { applied: false, failureReason: 'Rel.AI retains workspace mutation authority.' };
  }
  if (method === 'workspace/workspaceFolders') return null;
  return null;
}

export { DEFAULT_REQUEST_TIMEOUT_MS, LspClient };
