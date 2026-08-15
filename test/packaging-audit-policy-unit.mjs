import assert from 'node:assert/strict';
import { evaluatePackagingAudit } from '../scripts/audit-packaging.mjs';

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

console.log('Packaging audit fails closed on all high and critical build-tool findings without stale advisory exceptions.');
