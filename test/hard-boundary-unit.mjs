import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveSafePath, validateRelativePath, isSecretPath, SECRET_PATH_PATTERNS } = require('../src/safety.js');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-hard-boundary-'));

function throws(fn) {
  try {
    fn();
    return false;
  } catch (error) {
    assert.ok(error instanceof Error);
    return true;
  }
}

assert.ok(throws(() => resolveSafePath(ROOT, '../etc/passwd')), 'traversal rejected');
assert.ok(throws(() => resolveSafePath(ROOT, '../../etc/passwd')), 'double traversal rejected');
assert.ok(throws(() => resolveSafePath(ROOT, 'a/../../b')), 'embedded traversal rejected');
console.log('1. traversal rejected: OK');

assert.ok(throws(() => resolveSafePath(ROOT, '/etc/passwd')), 'absolute unix rejected');
assert.ok(throws(() => resolveSafePath(ROOT, 'C:/Windows/System32/drivers/etc/hosts')), 'absolute windows rejected');
console.log('2. absolute rejected: OK');

assert.ok(throws(() => resolveSafePath(ROOT, '')), 'empty rejected');
assert.ok(throws(() => resolveSafePath(ROOT, '   ')), 'whitespace rejected');
console.log('3. empty rejected: OK');

assert.ok(isSecretPath('.env'), '.env');
assert.ok(isSecretPath('config/.env'), 'nested .env');
assert.ok(isSecretPath('.env.local'), '.env.local');
assert.ok(isSecretPath('.env-prod'), '.env-prod');
assert.ok(throws(() => resolveSafePath(ROOT, '.env')), 'resolveSafePath throws on .env');
console.log('4. .env flagged: OK');

assert.ok(isSecretPath('.ssh/id_rsa'), 'ssh id_rsa');
assert.ok(isSecretPath('id_rsa'), 'id_rsa at root');
assert.ok(isSecretPath('id_ed25519'), 'ed25519 at root');
assert.equal(isSecretPath('known_hosts'), false, 'known_hosts contains public host keys and must remain accessible');
assert.ok(throws(() => resolveSafePath(ROOT, '.ssh/id_rsa')), 'resolveSafePath throws on ssh key');
console.log('5. ssh keys flagged: OK');

assert.ok(isSecretPath('cert.pem'), '.pem');
assert.ok(isSecretPath('private.key'), '.key');
assert.ok(isSecretPath('store.p12'), '.p12');
assert.ok(isSecretPath('cert.pfx'), '.pfx');
console.log('6. cert/key extensions flagged: OK');

assert.ok(isSecretPath('secrets/db.json'), 'secrets dir');
assert.ok(isSecretPath('credentials.json'), 'credentials root');
assert.ok(isSecretPath('secret.txt'), 'secret prefix');
console.log('7. secrets/credentials flagged: OK');

assert.ok(isSecretPath('.aws/credentials'), '.aws/');
assert.ok(isSecretPath('.azure/config'), '.azure/');
assert.ok(isSecretPath('.kube/config'), '.kube/');
assert.ok(isSecretPath('kubeconfig'), 'kubeconfig root');
console.log('8. cloud paths flagged: OK');

assert.ok(isSecretPath('firebase-adminsdk-xyz.json'), 'firebase admin');
assert.ok(isSecretPath('service-account-prod.json'), 'service account');
console.log('9. firebase/service-account flagged: OK');

assert.ok(isSecretPath('.npmrc'), '.npmrc');
assert.ok(isSecretPath('.pypirc'), '.pypirc');
assert.ok(isSecretPath('.netrc'), '.netrc');
console.log('10. rc files flagged: OK');

assert.equal(isSecretPath('.git/config'), false, '.git/config not in secret patterns (current behavior)');
const gitConfigPath = resolveSafePath(ROOT, '.git/config');
assert.ok(gitConfigPath.relativePath === '.git/config', 'resolveSafePath allows .git/config (current behavior)');
console.log('11. .git current behavior pinned: OK');

assert.ok(isSecretPath(String.raw`config\.env`), 'backslash .env');
assert.ok(throws(() => resolveSafePath(ROOT, String.raw`..\etc`)), 'backslash traversal rejected');
console.log('12. backslash normalization: OK');

const sourcePath = resolveSafePath(ROOT, 'src/foo.js');
assert.equal(sourcePath.relativePath, 'src/foo.js');
console.log('13. ordinary paths pass: OK');

const longPath = 'a/'.repeat(300) + 'file.js';
assert.ok(longPath.length > 512);
assert.ok(throws(() => validateRelativePath(longPath)), 'overly long rejected');
console.log('14. >512 char rejected: OK');

assert.ok(Array.isArray(SECRET_PATH_PATTERNS));
assert.ok(SECRET_PATH_PATTERNS.length >= 12);
console.log('15. SECRET_PATH_PATTERNS exposed: OK');

fs.rmSync(ROOT, { recursive: true, force: true });
console.log('hard-boundary unit tests passed.');
