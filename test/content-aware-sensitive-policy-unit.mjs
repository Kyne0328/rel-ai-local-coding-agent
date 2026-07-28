import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveSafePath, writeTextFileSafe, evaluateSensitiveContent } from "../src/safety.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-content-policy-'));
try {
  fs.writeFileSync(path.join(root, '.npmrc'), 'registry=https://registry.npmjs.org/\nengine-strict=true\n');
  assert.doesNotThrow(() => resolveSafePath(root, '.npmrc', { operation: 'read' }));
  writeTextFileSafe(root, '.npmrc', 'registry=https://registry.npmjs.org/\nfund=false\n');
  assert.equal(evaluateSensitiveContent('.npmrc', null, '//registry.npmjs.org/:_authToken=top-secret\n').allowed, false);
  assert.throws(
    () => writeTextFileSafe(root, '.npmrc', '//registry.npmjs.org/:_authToken=top-secret\n'),
    /blocked sensitive path/
  );

  fs.writeFileSync(path.join(root, '.pypirc'), '[distutils]\nindex-servers = pypi\n[pypi]\nrepository = https://upload.pypi.org/legacy/\n');
  assert.doesNotThrow(() => resolveSafePath(root, '.pypirc', { operation: 'read' }));
  assert.throws(
    () => writeTextFileSafe(root, '.pypirc', '[pypi]\nusername=user\npassword=secret\n'),
    /blocked sensitive path/
  );

  const certificate = '-----BEGIN CERTIFICATE-----\nPUBLICDATA\n-----END CERTIFICATE-----\n';
  fs.writeFileSync(path.join(root, 'server.pem'), certificate);
  assert.doesNotThrow(() => resolveSafePath(root, 'server.pem', { operation: 'read' }));
  writeTextFileSafe(root, 'server.pem', certificate);
  assert.throws(
    () => writeTextFileSafe(root, 'server.pem', '-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----\n'),
    /blocked sensitive path/
  );

  fs.mkdirSync(path.join(root, 'secrets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'secrets', 'README.md'), '# Secret management guidance\nUse the deployment portal.\n');
  assert.doesNotThrow(() => resolveSafePath(root, 'secrets/README.md', { operation: 'read' }));
  assert.throws(
    () => writeTextFileSafe(root, 'secrets/config.txt', 'API_KEY=actual-secret\n'),
    /blocked sensitive path/
  );

  assert.equal(evaluateSensitiveContent('.netrc', null, 'machine example.com login user password pass').allowed, false);
  assert.equal(evaluateSensitiveContent('public.pem', null, certificate).allowed, true);
  console.log('Content-aware sensitive policy permits public forms and blocks credential material.');
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
