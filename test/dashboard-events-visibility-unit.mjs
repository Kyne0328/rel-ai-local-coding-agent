import assert from 'node:assert/strict';

const originalDocument = globalThis.document;
const originalEventSource = globalThis.EventSource;
const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

const visibilityListeners = new Set();
const documentStub = {
  visibilityState: 'visible',
  addEventListener(name, listener) {
    if (name === 'visibilitychange') visibilityListeners.add(listener);
  },
  removeEventListener(name, listener) {
    if (name === 'visibilitychange') visibilityListeners.delete(listener);
  }
};

const sources = [];
class FakeEventSource {
  static OPEN = 1;

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.readyState = 0;
    this.closed = false;
    this.listeners = new Map();
    sources.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }
}

try {
  globalThis.document = documentStub;
  globalThis.EventSource = FakeEventSource;
  globalThis.window = {
    setTimeout,
    clearTimeout,
    localStorage: { getItem: () => null }
  };

  const events = await import(`../src/ui/events.js?visibility-test=${Date.now()}`);
  events.initEvents(() => {}, () => {});
  events.startSSE();

  assert.equal(sources.length, 1, 'visible dashboards should open one live event stream');
  assert.equal(sources[0].url, '/events');
  assert.equal(sources[0].options.withCredentials, true);

  documentStub.visibilityState = 'hidden';
  for (const listener of visibilityListeners) listener();
  assert.equal(sources[0].closed, true, 'hiding the dashboard must close its live event stream');

  events.startSSE();
  assert.equal(sources.length, 1, 'hidden dashboards must not reopen the live event stream');

  documentStub.visibilityState = 'visible';
  for (const listener of visibilityListeners) listener();
  assert.equal(sources.length, 2, 'showing the dashboard must reconnect through the existing catch-up flow');
  assert.equal(sources[1].closed, false);

  events.stopSSE({ emit: false });
  assert.equal(sources[1].closed, true, 'stopping dashboard events must close the resumed stream');

  documentStub.visibilityState = 'hidden';
  globalThis.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  const api = await import(`../src/ui/api.js?visibility-timeout-test=${Date.now()}`);
  let requestSettled = false;
  const hiddenRequest = api.fetchJson('/slow-dashboard-request', { timeout: 80 }).then(result => {
    requestSettled = true;
    return result;
  });
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(requestSettled, false,
    'time spent minimized must not consume the dashboard request timeout budget');

  documentStub.visibilityState = 'visible';
  for (const listener of [...visibilityListeners]) listener();
  const timedOut = await hiddenRequest;
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.errorCode, 'dashboard_unavailable');
  assert.match(timedOut.error, /timed out/i,
    'a request that remains stalled after restore must still honor its foreground timeout');
} finally {
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  if (originalEventSource === undefined) delete globalThis.EventSource; else globalThis.EventSource = originalEventSource;
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  if (originalFetch === undefined) delete globalThis.fetch; else globalThis.fetch = originalFetch;
}

console.log('Dashboard event visibility lifecycle tests passed.');
