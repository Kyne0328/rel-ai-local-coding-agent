import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { chromiumCandidates, resolveChromiumRuntime } from '../src/chromiumRuntime.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-chromium-runtime-'));
try {
  const configured = path.join(root, 'chrome-test');
  fs.writeFileSync(configured, 'test');
  assert.deepEqual(resolveChromiumRuntime({ override: configured }), {
    executablePath: configured,
    product: 'configured Chromium'
  });
  assert.throws(
    () => resolveChromiumRuntime({ override: path.join(root, 'missing') }),
    error => error?.code === 'CHROMIUM_RUNTIME_OVERRIDE_INVALID'
  );

  const windows = chromiumCandidates({
    platform: 'win32',
    env: { PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
    bundledExecutablePath: ''
  });
  assert.equal(windows.some(candidate => candidate.product === 'Google Chrome'), true);
  assert.equal(windows.some(candidate => candidate.product === 'Microsoft Edge'), true);
  assert.equal(windows.some(candidate => candidate.product === 'Chromium'), true);

  const mac = chromiumCandidates({ platform: 'darwin', env: {}, bundledExecutablePath: '' });
  assert.equal(mac.some(candidate => candidate.executablePath.includes('Google Chrome.app')), true);

  console.log('Shared Chromium runtime discovery and configured-path validation tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
