import assert from 'node:assert/strict';
import { evaluatePackagingAudit, isTransientPackagingAuditFailure } from '../scripts/audit-packaging.mjs';

const cleanReport = {
  metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  vulnerabilities: {}
};
assert.deepEqual(evaluatePackagingAudit({ report: cleanReport }), {
  accepted: true,
  vulnerabilityCount: 0,
  packages: []
});

const moderateOnly = {
  metadata: { vulnerabilities: { low: 0, moderate: 1, high: 0, critical: 0, total: 1 } },
  vulnerabilities: {
    example: { severity: 'moderate' }
  }
};
assert.doesNotThrow(() => evaluatePackagingAudit({ report: moderateOnly }), 'the release gate is explicitly high-severity and above');

const highReport = {
  metadata: { vulnerabilities: { low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
  vulnerabilities: {
    'build-tool': { severity: 'high' }
  }
};
assert.throws(() => evaluatePackagingAudit({ report: highReport }), /1 high.*build-tool/i);

const criticalReport = {
  metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 1, total: 1 } },
  vulnerabilities: {
    'critical-build-tool': { severity: 'critical' }
  }
};
assert.throws(() => evaluatePackagingAudit({ report: criticalReport }), /1 critical.*critical-build-tool/i);
assert.equal(isTransientPackagingAuditFailure({ stderr: 'npm warn audit network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk' }), true);
assert.equal(isTransientPackagingAuditFailure({ stdout: JSON.stringify(highReport) }), false, 'real audit findings must not be classified as registry outages');

console.log('Packaging audit blocks confirmed high/critical findings and distinguishes advisory-service outages.');
