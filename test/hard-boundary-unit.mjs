import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveSafePath, validateRelativePath, isSecretPath, SECRET_PATH_PATTERNS } = require('../src/safety.js');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-hard-boundary-'));

function throws(fn) {
  try { fn(); return false; } catch (_) { return true; }
}

// Traversal rejected
{
  assert.ok(throws(() => resolveSafePath(ROOT, '../etc/passwd')), 'traversal rejected');
  assert.ok(throws(() => resolveSafePath(ROOT, '../../etc/passwd')), 'double traversal rejected');
  assert.ok(throws(() => resolveSafePath(ROOT, 'a/../../b')), 'embedded traversal rejected');
  console.log('1. traversal rejected: OK');
}

// Absolute paths rejected
{
  assert.ok(throws(() => resolveSafePath(ROOT, '/etc/passwd')), 'absolute unix rejected');
  assert.ok(throws(() => resolveSafePath(ROOT, 'C:/Windows/System32/drivers/etc/hosts')), 'absolute windows rejected');
  console.log('2. absolute rejected: OK');
}

// Empty path rejected
{
  assert.ok(throws(() => resolveSafePath(ROOT, '')), 'empty rejected');
  assert.ok(throws(() => resolveSafePath(ROOT, '   ')), 'whitespace rejected');
  console.log('3. empty rejected: OK');
}

// .env variants flagged as secret
{
  assert.ok(isSecretPath('.env'), '.env');
  assert.ok(isSecretPath('config/.env'), 'nested .env');
  assert.ok(isSecretPath('.env.local'), '.env.local');
  assert.ok(isSecretPath('.env-prod'), '.env-prod');
  assert.ok(throws(() => resolveSafePath(ROOT, '.env')), 'resolveSafePath throws on .env');
  console.log('4. .env flagged: OK');
}

// SSH keys flagged
{
  assert.ok(isSecretPath('.ssh/id_rsa'), 'ssh id_rsa');
  assert.ok(isSecretPath('id_rsa'), 'id_rsa at root');
  assert.ok(isSecretPath('id_ed25519'), 'ed25519 at root');
  assert.ok(isSecretPath('known_hosts'), 'known_hosts at root');
  assert.ok(throws(() => resolveSafePath(ROOT, '.ssh/id_rsa')), 'resolveSafePath throws on ssh key');
  console.log('5. ssh keys flagged: OK');
}

// Certificate / key file extensions flagged
{
  assert.ok(isSecretPath('cert.pem'), '.pem');
  assert.ok(isSecretPath('private.key'), '.key');
  assert.ok(isSecretPath('store.p12'), '.p12');
  assert.ok(isSecretPath('cert.pfx'), '.pfx');
  console.log('6. cert/key extensions flagged: OK');
}

// secrets/credentials patterns flagged
{
  assert.ok(isSecretPath('secrets/db.json'), 'secrets dir');
  assert.ok(isSecretPath('credentials.json'), 'credentials root');
  assert.ok(isSecretPath('secret.txt'), 'secret prefix');
  console.log('7. secrets/credentials flagged: OK');
}

// Cloud provider config paths flagged
{
  assert.ok(isSecretPath('.aws/credentials'), '.aws/');
  assert.ok(isSecretPath('.azure/config'), '.azure/');
  assert.ok(isSecretPath('.kube/config'), '.kube/');
  assert.ok(isSecretPath('kubeconfig'), 'kubeconfig root');
  console.log('8. cloud paths flagged: OK');
}

// Firebase / service-account JSON flagged
{
  assert.ok(isSecretPath('firebase-adminsdk-xyz.json'), 'firebase admin');
  assert.ok(isSecretPath('service-account-prod.json'), 'service account');
  console.log('9. firebase/service-account flagged: OK');
}

// rc files flagged
{
  assert.ok(isSecretPath('.npmrc'), '.npmrc');
  assert.ok(isSecretPath('.pypirc'), '.pypirc');
  assert.ok(isSecretPath('.netrc'), '.netrc');
  console.log('10. rc files flagged: OK');
}

// .git/ is NOT in secret patterns (current behavior - workspace internals exposed)
{
  // .git/config does not throw secret check, but resolveSafePath would still succeed if inside root.
  // This pins current behavior - .git is excluded from indexing (DEFAULT_EXCLUDED_NAMES) but not blocked on direct path.
  assert.equal(isSecretPath('.git/config'), false, '.git/config not in secret patterns (current behavior)');
  // resolveSafePath does NOT throw for .git/config
  const r = resolveSafePath(ROOT, '.git/config');
  assert.ok(r.relativePath === '.git/config', 'resolveSafePath allows .git/config (current behavior)');
  console.log('11. .git current behavior pinned: OK');
}

// Backslash paths normalized
{
  assert.ok(isSecretPath('config\\.env'), 'backslash .env');
  assert.ok(throws(() => resolveSafePath(ROOT, '..\\etc')), 'backslash traversal rejected');
  console.log('12. backslash normalization: OK');
}

// Non-secret paths pass
{
  const r = resolveSafePath(ROOT, 'src/foo.js');
  assert.equal(r.relativePath, 'src/foo.js');
  console.log('13. ordinary paths pass: OK');
}

// validateRelativePath length limit
{
  const longPath = 'a/'.repeat(300) + 'file.js';
  assert.ok(longPath.length > 512);
  assert.ok(throws(() => validateRelativePath(longPath)), 'overly long rejected');
  console.log('14. >512 char rejected: OK');
}

// SECRET_PATH_PATTERNS exported
{
  assert.ok(Array.isArray(SECRET_PATH_PATTERNS));
  assert.ok(SECRET_PATH_PATTERNS.length >= 12);
  console.log('15. SECRET_PATH_PATTERNS exposed: OK');
}

// Cleanup
try { fs.rmdirSync(ROOT); } catch (_) {}

console.log('hard-boundary unit tests passed.');
