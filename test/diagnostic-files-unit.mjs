import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDiagnosticFiles, fileTimestamp } from "../electron/diagnostic-files.js";
import { sanitizeDiagnosticValue } from "../src/diagnostics.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-diagnostic-files-'));
let opened = '';
const files = createDiagnosticFiles({
  app: { getPath: name => name === 'userData' ? root : '' },
  shell: { openPath: async target => { opened = target; return ''; } },
  sanitizeDiagnosticValue,
  now: () => new Date('2026-07-25T07:30:45.123Z')
});

try {
  assert.equal(files.directory(), path.join(root, 'diagnostics'));
  assert.equal(files.serviceLogPath(), path.join(root, 'diagnostics', 'service.log'));
  assert.equal(fileTimestamp(new Date('2026-07-25T07:30:45.123Z')), '20260725-073045Z');

  const exported = await files.exportReport({ ok: true, token: 'secret', nested: { password: 'hidden', safe: 'visible' } });
  assert.equal(exported.filename, 'relai-diagnostic-state-20260725-073045Z.json');
  assert.equal(fs.existsSync(exported.path), true);
  const payload = JSON.parse(fs.readFileSync(exported.path, 'utf8'));
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.report.token, '[redacted]');
  assert.equal(payload.report.nested.password, '[redacted]');
  assert.equal(payload.report.nested.safe, 'visible');

  const openedResult = await files.openFolder();
  assert.equal(openedResult.ok, true);
  assert.equal(opened, files.directory());
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Diagnostic files unit passed');
