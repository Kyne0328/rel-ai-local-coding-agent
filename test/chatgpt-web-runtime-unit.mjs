import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ChatGptWebRuntime } from '../src/agents/chatgptWebRuntime.js';

class FakePage {
  constructor(events) {
    this.events = events;
    this.closed = false;
  }
  async goto(url, options) { this.events.push(['goto', url, options.waitUntil]); }
  async close() { this.closed = true; this.events.push(['page.close']); }
}

class FakeContext {
  constructor(events, existingPage = null) {
    this.events = events;
    this.existingPage = existingPage;
    this.closed = false;
    this.createdPages = [];
  }
  pages() { return this.existingPage ? [this.existingPage] : []; }
  async newPage() {
    const page = new FakePage(this.events);
    this.createdPages.push(page);
    this.events.push(['newPage']);
    return page;
  }
  async close() { this.closed = true; this.events.push(['context.close']); }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-chatgpt-runtime-'));
const profilePath = path.join(root, 'isolated-chatgpt-profile');
const events = [];
const launches = [];
let authenticated = false;
const adapter = {
  async isAuthenticated() {
    events.push(['isAuthenticated']);
    return authenticated;
  },
  async listReasoningLevels() {
    events.push(['listReasoningLevels']);
    return ['instant', 'medium', 'high'];
  },
  async prepareSession(_page, options) {
    events.push(['prepareSession', options]);
  },
  async submitPrompt(_page, prompt) {
    events.push(['submitPrompt', prompt]);
  }
};
const browserFactory = {
  async launchPersistentContext(userDataDir, options) {
    const page = options.headless === false ? new FakePage(events) : null;
    const context = new FakeContext(events, page);
    launches.push({ userDataDir, options: { ...options }, context, page });
    events.push(['launch', options.headless]);
    return context;
  }
};
const runtimeResolver = () => ({ executablePath: path.join(root, 'chrome'), product: 'Test Chrome' });

try {
  const runtime = new ChatGptWebRuntime({
    config: { stateDir: root },
    pageAdapter: adapter,
    browserFactory,
    runtimeResolver,
    profilePath,
    availableReasoning: ['instant', 'medium', 'high']
  });

  const capabilities = await runtime.getCapabilities();
  assert.equal(capabilities.outputTransport, 'mcp');
  assert.equal(capabilities.requiresAuthentication, true);
  assert.deepEqual(capabilities.reasoning, ['instant', 'medium', 'high']);
  assert.deepEqual(runtime.authenticationStatus().browser, {
    available: true,
    product: 'Test Chrome',
    errorCode: null
  });

  const opened = await runtime.beginAuthentication();
  assert.equal(opened.status, 'authentication_open');
  assert.equal(opened.browserProduct, 'Test Chrome');
  assert.equal(launches[0].userDataDir, path.resolve(profilePath));
  assert.equal(launches[0].options.headless, false);
  assert.equal(Object.hasOwn(opened, 'profilePath'), false, 'profile location must stay private');
  assert.equal(Object.hasOwn(opened, 'cookies'), false, 'authentication cookies must never be returned');

  await assert.rejects(() => runtime.finishAuthentication(), error => error?.code === 'CHATGPT_LOGIN_REQUIRED');
  assert.equal(launches[0].context.closed, false, 'failed login check keeps the visible login window available');
  authenticated = true;
  const finished = await runtime.finishAuthentication();
  assert.equal(finished.status, 'authenticated');
  assert.deepEqual(finished.reasoning, ['instant', 'medium', 'high']);
  assert.equal(events.some(event => event[0] === 'listReasoningLevels'), true);
  assert.equal(launches[0].context.closed, true);
  assert.equal(runtime.authenticationStatus().status, 'authentication_saved');
  assert.deepEqual(runtime.authenticationStatus().reasoning, ['instant', 'medium', 'high']);

  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'agents', 'chatgpt-web.json'), 'utf8'));
  assert.deepEqual(Object.keys(metadata).sort(), ['authenticatedAt', 'reasoning', 'schemaVersion']);
  assert.deepEqual(metadata.reasoning, ['instant', 'medium', 'high']);
  assert.equal(JSON.stringify(metadata).includes('cookie'), false);
  assert.equal(JSON.stringify(metadata).includes(profilePath), false);

  const spawned = await runtime.spawn({
    objective: 'Inspect connection handling.', role: 'reviewer', reasoning: 'pro'
  }, {
    agentId: 'agent_test',
    prompt: 'delegated protocol prompt'
  });
  assert.match(spawned.runtimeTaskId, /^chatgpt_agent_/);
  assert.equal(spawned.reasoning, 'high');
  assert.equal(launches[1].userDataDir, path.resolve(profilePath), 'execution must reuse the same isolated profile');
  assert.equal(launches[1].options.headless, true);
  const executionPage = launches[1].context.createdPages[0];
  assert.ok(executionPage);
  assert.deepEqual(events.filter(event => ['isAuthenticated', 'prepareSession', 'submitPrompt'].includes(event[0])).slice(-3), [
    ['isAuthenticated'],
    ['prepareSession', { temporary: true, reasoning: 'high' }],
    ['submitPrompt', 'delegated protocol prompt']
  ]);
  assert.equal(typeof adapter.readResponse, 'undefined', 'runtime must not depend on response scraping');

  await assert.rejects(() => runtime.beginAuthentication(), error => error?.code === 'CHATGPT_AGENTS_ACTIVE');
  const cancelled = await runtime.cancel(spawned.runtimeTaskId);
  assert.equal(cancelled.cancelled, true);
  assert.equal(executionPage.closed, true);
  assert.equal((await runtime.cancel(spawned.runtimeTaskId)).alreadyTerminal, true);

  authenticated = false;
  await assert.rejects(
    () => runtime.spawn({ objective: 'Requires login.', reasoning: 'medium' }, { prompt: 'prompt' }),
    error => error?.code === 'CHATGPT_LOGIN_REQUIRED'
  );

  await runtime.dispose();
  assert.equal(launches[1].context.closed, true);

  assert.throws(
    () => new ChatGptWebRuntime({ config: { stateDir: root }, pageAdapter: {}, browserFactory, runtimeResolver }),
    /isAuthenticated/
  );

  const unavailableRuntime = new ChatGptWebRuntime({
    config: { stateDir: path.join(root, 'unavailable') },
    pageAdapter: adapter,
    browserFactory,
    runtimeResolver() {
      throw new Error('secret executable path C:/Users/test/private/chrome.exe token=abc123');
    }
  });
  const unavailableStatus = unavailableRuntime.authenticationStatus();
  assert.deepEqual(unavailableStatus.browser, {
    available: false,
    product: null,
    errorCode: 'CHATGPT_RUNTIME_UNAVAILABLE'
  });
  assert.doesNotMatch(JSON.stringify(unavailableStatus), /private|chrome\.exe|abc123/);
  await unavailableRuntime.dispose();

  console.log('ChatGPT web runtime profile isolation, browser availability, manual auth, hidden execution, MCP-only output, and cleanup tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
