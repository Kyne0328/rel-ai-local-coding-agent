import assert from 'node:assert/strict';

const originalDocument = globalThis.document;
const originalEventSource = globalThis.EventSource;
const originalWindow = globalThis.window;

const visibilityListeners = new Set();
const documentStub = {
  visibilityState: 'visible',
  addEventListener(name, listener) {
    if (name === 'visibilitychange') visibilityListeners.add(listener);
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
} finally {
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  if (originalEventSource === undefined) delete globalThis.EventSource; else globalThis.EventSource = originalEventSource;
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
}

console.log('Dashboard event visibility lifecycle tests passed.');
