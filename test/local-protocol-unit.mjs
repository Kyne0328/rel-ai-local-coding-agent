import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { localRendererUrl, resolveLocalRendererPath } = require('../electron/local-protocol.js');
const root = path.resolve('electron/renderer');

assert.equal(localRendererUrl('status.html'), 'relai-app://renderer/status.html');
assert.equal(localRendererUrl('wizard.html', { recovery: 1 }), 'relai-app://renderer/wizard.html?recovery=1');
assert.throws(() => localRendererUrl('../status.html'), /file name/);
assert.equal(resolveLocalRendererPath('relai-app://renderer/status.html?ignored=1', root), path.join(root, 'status.html'));
for (const target of [
  'file:///tmp/status.html',
  'relai-app://other/status.html',
  'relai-app://renderer/../main.js',
  'relai-app://renderer/unknown.json',
  'https://renderer/status.html'
]) assert.equal(resolveLocalRendererPath(target, root), '');

console.log('Local Electron protocol tests passed.');
