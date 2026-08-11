import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { normalizeVerifyChecks } from '../src/bridge/validationChecks.js';
import { relaiVerify } from '../src/bridge/validation.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-workflow-check-exec-'));
try {
  const frontend = path.join(root, 'front-end');
  const backend = path.join(root, 'back-end');
  fs.mkdirSync(frontend, { recursive: true });
  fs.mkdirSync(backend, { recursive: true });
  fs.writeFileSync(path.join(frontend, 'package.json'), JSON.stringify({ scripts: { test: `node -e "require('fs').writeFileSync('frontend-marker.txt','ok')"` } }));
  fs.writeFileSync(path.join(backend, 'package.json'), JSON.stringify({ scripts: { test: `node -e "require('fs').writeFileSync('backend-marker.txt','wrong')"` } }));
  const normalized = normalizeVerifyChecks({ checks: ['npm:front-end:test'] }, root, 'quick');
  assert.equal(normalized.checkUnits.length, 1);
  assert.equal(normalized.checkUnits[0].cwd, 'front-end');
  assert.equal(normalized.checkUnits[0].command, 'npm test');

  const result = await relaiVerify({ alias: 'repo', path: root, commands: {}, testCommands: {} }, { stateDir: path.join(root, '.state') }, {
    checks: ['npm:front-end:test'],
    changedFiles: ['front-end/src/app.js'],
    timeoutMs: 30000
  });
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(frontend, 'frontend-marker.txt')), true);
  assert.equal(fs.existsSync(path.join(root, 'frontend-marker.txt')), false);
  assert.equal(fs.existsSync(path.join(backend, 'backend-marker.txt')), false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Structured nested validation executes in package cwd.');