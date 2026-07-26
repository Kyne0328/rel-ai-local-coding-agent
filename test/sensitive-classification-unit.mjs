import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classifySensitivePath, isSecretPath } = require('../src/safety.js');

assert.deepEqual(classifySensitivePath('known_hosts'), {
  sensitive: false,
  classification: 'ordinary_repository_file',
  reason: 'no sensitive path rule matched'
});
assert.equal(isSecretPath('known_hosts'), false);

assert.equal(classifySensitivePath('.env').classification, 'environment_secret');
assert.equal(classifySensitivePath('.npmrc').classification, 'authentication_config');
assert.equal(classifySensitivePath('.ssh/id_ed25519').classification, 'private_key');
assert.equal(classifySensitivePath('service-account-prod.json').classification, 'service_account_credentials');
assert.equal(classifySensitivePath('bundle.p12').classification, 'key_or_certificate_bundle');
assert.equal(classifySensitivePath('.aws/credentials').classification, 'credential_store');
assert.equal(classifySensitivePath('credentials/example.json').classification, 'secret_named_location');
assert.equal(classifySensitivePath('secret.notes').classification, 'secret_named_file');

console.log('Sensitive path classifications are explicit and known_hosts remains accessible.');
