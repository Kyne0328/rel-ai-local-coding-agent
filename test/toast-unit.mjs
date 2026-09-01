import assert from 'node:assert/strict';

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || '').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.type = '';
    this.isConnected = false;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild(node) {
    node.parentNode = this;
    this.children.push(node);
    setConnected(node, this.isConnected);
    return node;
  }

  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, once: options?.once === true });
    this.listeners.set(type, entries);
  }

  dispatch(type) {
    const entries = [...(this.listeners.get(type) || [])];
    for (const entry of entries) {
      entry.listener({ type, target: this, currentTarget: this });
      if (entry.once) {
        const current = this.listeners.get(type) || [];
        this.listeners.set(type, current.filter(item => item !== entry));
      }
    }
  }

  contains(node) {
    for (let current = node; current; current = current.parentNode) {
      if (current === this) return true;
    }
    return false;
  }

  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
    setConnected(this, false);
  }
}

function setConnected(element, connected) {
  element.isConnected = connected;
  for (const child of element.children) setConnected(child, connected);
}

const body = new FakeElement('body');
body.isConnected = true;
const documentStub = {
  body,
  activeElement: null,
  createElement: tagName => new FakeElement(tagName)
};

const originalDocument = globalThis.document;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const originalDateNow = Date.now;
let now = 1000;
let nextTimerId = 0;
const timers = new Map();

globalThis.document = documentStub;
globalThis.setTimeout = (callback, delay = 0) => {
  const id = ++nextTimerId;
  timers.set(id, { callback, due: now + Math.max(0, Number(delay) || 0) });
  return id;
};
globalThis.clearTimeout = id => { timers.delete(id); };
Date.now = () => now;

function advance(ms) {
  const target = now + ms;
  while (true) {
    let next = null;
    for (const [id, timer] of timers) {
      if (timer.due > target) continue;
      if (!next || timer.due < next.timer.due) next = { id, timer };
    }
    if (!next) break;
    now = next.timer.due;
    timers.delete(next.id);
    next.timer.callback();
  }
  now = target;
}

try {
  const { toast } = await import(new URL('../src/ui/components/toast.js?toast-unit', import.meta.url));

  const first = toast('Saved', { variant: 'success', duration: 100 });
  const second = toast('Saved', { variant: 'success', duration: 100 });
  const region = body.children[0];
  assert.strictEqual(first, second, 'identical active notifications should be coalesced');
  assert.equal(region.children.length, 1, 'coalescing must not add another notification element');
  assert.equal(first.getAttribute('role'), null, 'the dismiss control must stay outside the live status node');
  assert.equal(first.children[1].getAttribute('role'), 'status');
  assert.equal(first.children[1].getAttribute('aria-atomic'), 'true');

  advance(60);
  first.dispatch('mouseenter');
  advance(1000);
  assert.equal(first.isConnected, true, 'a hovered transient notification must not expire');
  first.dispatch('mouseleave');
  advance(39);
  assert.equal(first.isConnected, true, 'the remaining lifetime should resume after hover');
  advance(1);
  assert.equal(first.isConnected, false, 'the notification should expire after its remaining lifetime');

  const persistent = toast('Connection failed', { variant: 'error' });
  assert.equal(persistent.children[1].getAttribute('role'), 'alert');
  advance(100000);
  assert.equal(persistent.isConnected, true, 'error notifications must remain until dismissed by default');
  const duplicateError = toast('Connection failed', { variant: 'error' });
  assert.strictEqual(persistent, duplicateError, 'repeated persistent errors should not stack');
  persistent.children[2].dispatch('click');
  assert.equal(persistent.isConnected, false, 'manual dismissal must remove a persistent error');

  const afterDismiss = toast('Connection failed', { variant: 'error' });
  assert.notStrictEqual(afterDismiss, persistent, 'a dismissed notification may be shown again later');
  console.log('Toast behavior passed.');
} finally {
  globalThis.document = originalDocument;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  Date.now = originalDateNow;
}
