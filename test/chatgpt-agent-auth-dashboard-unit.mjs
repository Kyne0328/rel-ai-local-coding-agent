import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatGptAgentHandlers } from '../src/http/dashboardAgents.js';
const calls = [];
const fakeService = {
  listForDashboard() {
    calls.push('list');
    return [{ agent_id: `agent_${'a'.repeat(43)}`, status: 'working', role: 'reviewer', reasoning: 'high', objective: 'Review safely.', workspace: 'repo' }];
  },
  async cancelForDashboard(args) {
    calls.push(['cancel', args.agent_id]);
    return { agent_id: args.agent_id, status: 'cancelled', error: 'Cancelled from Rel.AI desktop.' };
  },
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
  if (expected === 'status') {
    assert.equal(calls.includes('status'), true);
    assert.equal(calls.includes('list'), true);
  } else {
    assert.equal(calls.at(-1), expected);
  }
  assert.equal(JSON.stringify(payload).includes('cookie'), false);
  assert.equal(JSON.stringify(payload).includes('profilePath'), false);
  assert.equal(JSON.stringify(payload).includes('executablePath'), false);
  if (expected === 'status') {
    assert.deepEqual(payload.browser, { available: true, product: 'Test Chrome', errorCode: null });
    assert.equal(payload.agents.length, 1);
    assert.equal(payload.agents[0].objective, 'Review safely.');
    assert.equal(JSON.stringify(payload.agents).includes('principalFingerprint'), false);
  }
}

const cancelResponse = responseRecorder();
await handlers.handleChatGptAgentCancel(context(cancelResponse.res, JSON.stringify({ agent_id: `agent_${'a'.repeat(43)}` })));
assert.equal(cancelResponse.status(), 200);
assert.equal(cancelResponse.json().status, 'cancelled');
assert.deepEqual(calls.at(-1), ['cancel', `agent_${'a'.repeat(43)}`]);

const missingCancelResponse = responseRecorder();
await handlers.handleChatGptAgentCancel(context(missingCancelResponse.res, '{}'));
assert.deepEqual(missingCancelResponse.json(), {
  ok: false,
  errorCode: 'AGENT_ID_REQUIRED',
  error: 'Delegated agent id is required.'
});

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
assert.match(serverSource, /"\/api\/agents\/chatgpt\/cancel".*handleChatGptAgentCancel/);

console.log('ChatGPT subagent dashboard handlers expose safe auth/activity status and desktop cancellation.');
function context(res, body = '') {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
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