import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installLocalProtocol, localRendererUrl, resolveLocalRendererPath } from '../electron/local-protocol.js';

const root = path.resolve('electron/renderer');

assert.equal(localRendererUrl('status.html'), 'relai-app://renderer/status.html');
assert.equal(localRendererUrl('wizard.html', { recovery: 1 }), 'relai-app://renderer/wizard.html?recovery=1');
assert.throws(() => localRendererUrl('../status.html'), /file name/);
assert.equal(resolveLocalRendererPath('relai-app://renderer/status.html?ignored=1', root), path.join(root, 'status.html'));
for (const target of [
  'file:///tmp/status.html',
  'relai-app://other/status.html',
  'relai-app://renderer/../main.js',
  'relai-app://renderer/%2e%2e/main.js',
  'relai-app://renderer/unknown.json',
  'https://renderer/status.html'
]) assert.equal(resolveLocalRendererPath(target, root), '');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-local-protocol-'));
try {
  fs.writeFileSync(path.join(temp, 'status.html'), '<main>ready</main>');
  let handler = null;
  const protocol = {
    handle(scheme, callback) {
      assert.equal(scheme, 'relai-app');
      handler = callback;
    }
  };
  assert.equal(installLocalProtocol(protocol, temp), true);
  assert.equal(installLocalProtocol(protocol, temp), false, 'the same protocol object must not register twice');

  const existing = await handler({ url: 'relai-app://renderer/status.html' });
  assert.equal(existing.status, 200);
  assert.equal(existing.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await existing.text(), '<main>ready</main>');

  const missing = await handler({ url: 'relai-app://renderer/missing.html' });
  assert.equal(missing.status, 404, 'missing allow-listed renderer files must fail through the async read path');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Local Electron protocol tests passed.');
