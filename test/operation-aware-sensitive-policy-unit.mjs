import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveSafePath, assertPathOperationAllowed } = require('../src/safety.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-operation-policy-'));
try {
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=hidden\n');

  for (const operation of ['read', 'write', 'replace', 'review', 'delete']) {
    assert.throws(
      () => resolveSafePath(root, '.env', { operation }),
      (error) => error?.code === 'SENSITIVE_PATH_RESTRICTED' && error?.operation === operation,
      `${operation} must remain denied for secret-bearing files`
    );
  }

  assert.throws(
    () => resolveSafePath(root, '.env', { operation: 'commit' }),
    (error) => error?.operation === 'commit',
    'commit must remain denied without explicit authorization'
  );

  const authorized = resolveSafePath(root, '.env', {
    operation: 'commit',
    allowSensitive: true
  });
  assert.equal(authorized.relativePath, '.env');
  assert.equal(fs.readFileSync(authorized.absolutePath, 'utf8'), 'TOKEN=hidden\n');

  assert.throws(
    () => assertPathOperationAllowed('.env', 'write', { allowSensitive: true }),
    /blocked sensitive path/,
    'authorization must be operation-specific rather than a generic bypass'
  );

  assert.doesNotThrow(() => resolveSafePath(root, '.env.example', { operation: 'write' }));
  console.log('Operation-aware sensitive-path policy passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
