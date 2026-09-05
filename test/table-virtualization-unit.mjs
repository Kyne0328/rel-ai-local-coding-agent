import test from 'node:test';
import assert from 'node:assert/strict';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.colSpan = 0;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  before(child) {
    const index = this.parentNode.children.indexOf(this);
    child.parentNode = this.parentNode;
    this.parentNode.children.splice(index, 0, child);
  }
  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }
  set innerHTML(value) {
    if (value === '') {
      for (const child of this.children) child.parentNode = null;
      this.children = [];
    }
  }
}

let observer;
globalThis.document = { createElement: tag => new FakeElement(tag) };
globalThis.IntersectionObserver = class {
  constructor(callback) {
    this.callback = callback;
    observer = this;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { virtualizeTable } = await import('../src/ui/components/table.js');

test('virtualizer preserves the number of rendered rows when data changes', () => {
  const tbody = new FakeElement('tbody');
  const rows = Array.from({ length: 120 }, (_, index) => ({ index }));
  const virtualizer = virtualizeTable(tbody, rows, row => {
    const element = new FakeElement('tr');
    element.index = row.index;
    return element;
  });
  assert.equal(virtualizer.getRendered(), 50);
  assert.equal(tbody.children.at(-1)?.children[0]?.colSpan, 1, 'virtualization sentinel must not create implicit table columns');
  observer.callback([{ isIntersecting: true }]);
  assert.equal(virtualizer.getRendered(), 100);

  const updated = rows.map(row => ({ ...row, updated: true }));
  virtualizer.reinit(updated);
  assert.equal(virtualizer.getRendered(), 100, 'live updates must not collapse a reader back to the first virtual chunk');
  assert.equal(tbody.children.filter(child => child.tagName === 'tr' && Number.isInteger(child.index)).length, 100);
});
