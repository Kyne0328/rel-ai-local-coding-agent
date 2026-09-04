import assert from 'node:assert/strict';
import { isTransientAuditFailure } from '../scripts/audit-production.mjs';

assert.equal(isTransientAuditFailure({ stderr: 'npm warn audit network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk' }), true);
assert.equal(isTransientAuditFailure({ stderr: 'npm error code ETIMEDOUT' }), true);
assert.equal(isTransientAuditFailure({ stderr: '503 Service Unavailable' }), true);
assert.equal(isTransientAuditFailure({ stdout: '# npm audit report\nmoderate vulnerability found' }), false);

console.log('Production audit transient-failure classification tests passed.');
