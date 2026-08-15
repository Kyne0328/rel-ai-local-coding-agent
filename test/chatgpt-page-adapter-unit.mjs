import assert from 'node:assert/strict';

import {
  ChatGptPageAdapter,
  reasoningDisplayName,
  reasoningFromText
} from '../src/agents/chatgptPageAdapter.js';

class FakeLocator {
  constructor(page, key) {
    this.page = page;
    this.key = key;
  }
  first() { return this; }
  locator(selector) {
    if (selector.startsWith('xpath=ancestor::*')) return this;
    return this.page.locator(selector);
  }
  getByRole(name, options = {}) { return this.page.getByRole(name, options); }
  async isVisible() { return this.page.visible.has(this.key); }
  async click() {
    this.page.events.push(['click', this.key]);
    this.page.onClick(this.key);
  }
  async fill(value) {
    this.page.events.push(['fill', this.key, value]);
    this.page.filled = value;
  }
  async press(key) { this.page.events.push(['press', this.key, key]); }
  async getAttribute(name) { return this.page.attributes.get(`${this.key}:${name}`) ?? null; }
  async textContent() { return this.page.labels.get(this.key) || ''; }
}

class FakePage {
  constructor() {
    this.visible = new Set();
    this.attributes = new Map();
    this.labels = new Map();
    this.events = [];
    this.filled = '';
    this.keyboard = { press: async key => this.events.push(['keyboard', key]) };
    this.clickHandlers = new Map();
  }
  key(kind, name, matcher) { return `${kind}:${name}:${matcher instanceof RegExp ? matcher.source : matcher || ''}`; }
  getByRole(name, options = {}) { return new FakeLocator(this, this.key('role', name, options.name)); }
  getByText(matcher) { return new FakeLocator(this, this.key('text', 'text', matcher)); }
  locator(selector) { return new FakeLocator(this, this.key('locator', selector, '')); }
  showRole(name, matcher, attributes = {}, label = '') {
    const key = this.key('role', name, matcher);
    this.visible.add(key);
    if (label) this.labels.set(key, label);
    for (const [attribute, value] of Object.entries(attributes)) this.attributes.set(`${key}:${attribute}`, value);
    return key;
  }
  showText(matcher) {
    const key = this.key('text', 'text', matcher);
    this.visible.add(key);
    return key;
  }
  showLocator(selector) {
    const key = this.key('locator', selector, '');
    this.visible.add(key);
    return key;
  }
  on(key, handler) { this.clickHandlers.set(key, handler); }
  onClick(key) { this.clickHandlers.get(key)?.(); }
}

const adapter = new ChatGptPageAdapter();

assert.equal(reasoningFromText('Medium'), 'medium');
assert.equal(reasoningFromText('Extra High'), 'extra_high');
assert.equal(reasoningFromText('Pro Extended'), 'pro');
assert.equal(reasoningDisplayName('extra_high'), 'Extra High');

{
  const page = new FakePage();
  page.showLocator('#prompt-textarea');
  assert.equal(await adapter.isAuthenticated(page), true);
}

{
  const page = new FakePage();
  page.showRole('button', /log in|sign in/i);
  assert.equal(await adapter.isAuthenticated(page), false);
}

{
  const page = new FakePage();
  page.showLocator('#prompt-textarea');
  page.showRole('button', /log in|sign in|sign up/i);
  assert.equal(await adapter.isAuthenticated(page), false, 'a guest composer must not be treated as an authenticated account session');
}

{
  const page = new FakePage();
  page.showRole('textbox');
  assert.equal(await adapter.isAuthenticated(page), false, 'an unrelated or login textbox must not count as the ChatGPT composer');
}

{
  const page = new FakePage();
  page.showLocator('#prompt-textarea');
  const temporary = page.showRole('switch', /temporary chat/i, { 'aria-checked': 'false' });
  page.on(temporary, () => page.attributes.set(`${temporary}:aria-checked`, 'true'));
  const picker = page.showRole('button', /model|reasoning|thinking/i, {}, 'Instant');
  const medium = page.key('role', 'menuitem', '^Medium$');
  page.on(picker, () => page.visible.add(medium));
  page.on(medium, () => page.labels.set(picker, 'Medium'));
  page.visible.add(medium);
  await adapter.prepareSession(page, { temporary: true, reasoning: 'medium' });
  assert.equal(page.events.some(event => event[0] === 'click' && event[1] === temporary), true);
  assert.equal(page.events.some(event => event[0] === 'click' && event[1] === medium), true);
}

{
  const page = new FakePage();
  page.showLocator('#prompt-textarea');
  page.showRole('switch', /temporary chat/i, { 'aria-checked': 'true' });
  const picker = page.showRole('button', /model|reasoning|thinking/i, {}, 'Medium');
  const high = page.key('role', 'menuitem', '^High$');
  const extra = page.key('role', 'menuitem', '^Extra High$');
  page.on(picker, () => {
    page.visible.add(high);
    page.visible.add(extra);
  });
  const levels = await adapter.listReasoningLevels(page);
  assert.deepEqual(levels, ['high', 'extra_high']);
  assert.equal(page.events.some(event => event[0] === 'keyboard' && event[1] === 'Escape'), true);
}

{
  const page = new FakePage();
  page.showLocator('#prompt-textarea');
  page.showRole('switch', /temporary chat/i, { 'aria-checked': 'true' });
  page.showRole('button', /model|reasoning|thinking/i, {}, 'Medium');
  await assert.rejects(
    () => adapter.selectReasoning(page, 'pro'),
    error => error?.code === 'CHATGPT_REASONING_UNAVAILABLE'
  );
}

{
  const page = new FakePage();
  page.showLocator('#prompt-textarea');
  page.showRole('switch', /temporary chat/i, { 'aria-checked': 'true' });
  const picker = page.showRole('button', /model|reasoning|thinking/i, {}, 'Medium');
  const high = page.key('role', 'menuitem', '^High$');
  page.visible.add(high);
  page.on(high, () => page.labels.set(picker, 'Unverified selection'));
  await assert.rejects(
    () => adapter.selectReasoning(page, 'high'),
    error => error?.code === 'CHATGPT_REASONING_SELECTION_FAILED'
  );
}

{
  const page = new FakePage();
  page.showLocator('#prompt-textarea');
  await assert.rejects(
    () => adapter.enableTemporaryChat(page),
    error => error?.code === 'CHATGPT_TEMPORARY_MODE_REQUIRED'
  );
}

{
  const page = new FakePage();
  page.showText(/Juan can do anything the request describes/i);
  page.showRole('button', /^deny$/i);
  page.showRole('button', /^allow$/i);
  const dropdown = page.showLocator('button:has-text("Allow") + button');
  const persistent = page.key('role', 'menuitem', 'always.*allow|allow.*always|never ask');
  page.on(dropdown, () => page.visible.add(persistent));
  const result = await adapter.approveAppPermission(page);
  assert.deepEqual(result, { approved: true, persistent: true });
  assert.equal(page.events.some(event => event[0] === 'click' && event[1] === dropdown), true);
  assert.equal(page.events.some(event => event[0] === 'click' && event[1] === persistent), true);
}

{
  const page = new FakePage();
  page.showText(/completely different app title and request/i);
  page.showRole('button', /^deny$/i);
  const allow = page.showRole('button', /^allow$/i);
  const result = await adapter.approveAppPermission(page);
  assert.deepEqual(result, { approved: true, persistent: false });
  assert.equal(page.events.some(event => event[0] === 'click' && event[1] === allow), true);
}

{
  const page = new FakePage();
  page.showRole('button', /^allow$/i);
  const result = await adapter.approveAppPermission(page);
  assert.deepEqual(result, { approved: false, reason: 'not_present' });
  assert.equal(page.events.some(event => event[0] === 'click'), false, 'an Allow button without a permission-card Deny control must never be clicked');
}

{
  const page = new FakePage();
  page.showLocator('#prompt-textarea');
  page.showRole('button', /^send(?: message)?$/i);
  const result = await adapter.submitPrompt(page, 'delegated MCP protocol');
  assert.deepEqual(result, { submitted: true });
  assert.equal(page.filled, 'delegated MCP protocol');
  assert.equal(page.events.some(event => event[0] === 'click' && event[1].startsWith('role:button:')), true);
  assert.equal(typeof adapter.readResponse, 'undefined');
}

console.log('ChatGPT page adapter guest-auth rejection, Temporary Chat, verified reasoning selection, structural persistent app approval, prompt submission, and fail-closed tests passed.');
