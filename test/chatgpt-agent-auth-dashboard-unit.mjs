import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatGptAgentHandlers } from '../src/http/dashboardAgents.js';
const calls = [];
const fakeService = {
  async authenticationStatus() {
    calls.push('status');
    return {
      runtime: 'chatgpt-web',
      status: 'authentication_saved',
      authenticatedAt: '2026-08-14T10:00:00.000Z',
      reasoning: ['medium', 'high'],
      browser: { available: true, product: 'Test Chrome', errorCode: null }
    };
  },
  async beginAuthentication() {
    calls.push('open');
    return { runtime: 'chatgpt-web', status: 'authentication_open', browserProduct: 'Test Chrome' };
  },
  async finishAuthentication() {
    calls.push('finish');
    return { runtime: 'chatgpt-web', status: 'authenticated', authenticatedAt: '2026-08-14T10:01:00.000Z', reasoning: ['instant', 'medium', 'high'] };
  }
};
const handlers = createChatGptAgentHandlers({
  readConfigFn: () => ({ stateDir: 'test' }),
  getAgentServiceFn: async () => fakeService
});
for (const [name, expected] of [
  ['handleChatGptAgentStatus', 'status'],
  ['handleChatGptAgentAuthOpen', 'open'],
  ['handleChatGptAgentAuthFinish', 'finish']
]) {
  const response = responseRecorder();
  await handlers[name](context(response.res));
  const payload = response.json();
  assert.equal(response.status(), 200);
  assert.equal(payload.ok, true);
  assert.equal(calls.at(-1), expected);
  assert.equal(JSON.stringify(payload).includes('cookie'), false);
  assert.equal(JSON.stringify(payload).includes('profilePath'), false);
  assert.equal(JSON.stringify(payload).includes('executablePath'), false);
  if (expected === 'status') {
    assert.deepEqual(payload.browser, { available: true, product: 'Test Chrome', errorCode: null });
  }
}
const failing = createChatGptAgentHandlers({
  readConfigFn: () => ({}),
  getAgentServiceFn: async () => ({
    async finishAuthentication() {
      const error = new Error('ChatGPT login is not complete yet.');
      error.code = 'CHATGPT_LOGIN_REQUIRED';
      throw error;
    }
  })
});
const failedResponse = responseRecorder();
await failing.handleChatGptAgentAuthFinish(context(failedResponse.res));
assert.deepEqual(failedResponse.json(), {
  ok: false,
  errorCode: 'CHATGPT_LOGIN_REQUIRED',
  error: 'ChatGPT login is not complete yet.'
});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverSource = fs.readFileSync(path.join(root, 'src/httpServer.js'), 'utf8');
assert.match(serverSource, /"\/api\/agents\/chatgpt".*handleChatGptAgentStatus/);
assert.match(serverSource, /"\/api\/agents\/chatgpt\/auth\/open".*handleChatGptAgentAuthOpen/);
assert.match(serverSource, /"\/api\/agents\/chatgpt\/auth\/finish".*handleChatGptAgentAuthFinish/);

console.log('ChatGPT subagent dashboard auth handlers expose only safe status and lifecycle results.');
function context(res) {
  const req = Readable.from([]);
  req.headers = {};
  return { req, res, ae: '', options: { maxBodyBytes: 1024 } };
}
function responseRecorder() {
  let statusCode = 0;
  let body = Buffer.alloc(0);
  const headers = new Map();
  const res = {
    headersSent: false,
    destroyed: false,
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    writeHead(status, values = {}) {
      statusCode = status;
      this.headersSent = true;
      for (const [name, value] of Object.entries(values)) headers.set(name.toLowerCase(), value);
    },
    end(value = Buffer.alloc(0)) { body = Buffer.isBuffer(value) ? value : Buffer.from(String(value)); }
  };
  return { res, status: () => statusCode, json: () => JSON.parse(body.toString('utf8')) };
}