import assert from 'node:assert/strict';
import fs from 'node:fs';

import { normalizeSupportPolicy } from '../electron/update-support-policy.js';

const electronPackage = JSON.parse(fs.readFileSync('electron/package.json', 'utf8'));
const configuredPolicy = JSON.parse(fs.readFileSync('.github/relai/support-policy.json', 'utf8'));

assert.equal(electronPackage.build.files.includes('update-support-policy.js'), true, 'packaged desktop builds must include the update support-policy runtime');
const policy = normalizeSupportPolicy(configuredPolicy);
assert.ok(policy, 'the published support policy must satisfy the same parser used by the desktop runtime');
assert.match(policy.minimumSupportedVersion, /^\d+\.\d+\.\d+$/, 'support policy must declare a stable minimum supported version');
assert.match(policy.minimumRecommendedVersion, /^\d+\.\d+\.\d+$/, 'support policy must declare a stable recommended version');
assert.ok(Date.parse(policy.policyExpiresAt) > Date.now(), 'published support policy must not already be expired');

console.log('Remote update support policy packaging and published-policy contracts passed.');
