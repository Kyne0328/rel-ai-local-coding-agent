import assert from 'node:assert/strict';
import { evaluatePackagingAudit } from '../scripts/audit-packaging.mjs';

const policy = {
  schemaVersion: 1,
  expiresOn: '2026-08-31',
  allowedPackages: ['brace-expansion', 'minimatch'],
  allowedAdvisoryUrls: ['https://github.com/advisories/GHSA-mh99-v99m-4gvg']
};
const lockfile = {
  packages: {
    'node_modules/brace-expansion': { dev: true },
    'node_modules/minimatch': { peer: true }
  }
};
const acceptedReport = {
  metadata: { vulnerabilities: { high: 2, critical: 0 } },
  vulnerabilities: {
    'brace-expansion': {
      nodes: ['node_modules/brace-expansion'],
      via: [{ url: 'https://github.com/advisories/GHSA-mh99-v99m-4gvg' }]
    },
    minimatch: {
      nodes: ['node_modules/minimatch'],
      via: ['brace-expansion']
    }
  }
};

const accepted = evaluatePackagingAudit({
  report: acceptedReport,
  policy,
  lockfile,
  now: new Date('2026-07-31T12:00:00Z')
});
assert.equal(accepted.vulnerabilityCount, 2);
assert.deepEqual(accepted.advisoryUrls, ['https://github.com/advisories/GHSA-mh99-v99m-4gvg']);

assert.throws(() => evaluatePackagingAudit({
  report: { ...acceptedReport, vulnerabilities: { ...acceptedReport.vulnerabilities, unknown: { nodes: ['node_modules/minimatch'], via: ['brace-expansion'] } } },
  policy,
  lockfile,
  now: new Date('2026-07-31T12:00:00Z')
}), /unapproved package/);

assert.throws(() => evaluatePackagingAudit({
  report: { ...acceptedReport, vulnerabilities: { 'brace-expansion': { nodes: ['node_modules/brace-expansion'], via: [{ url: 'https://example.invalid/new-advisory' }] } } },
  policy,
  lockfile,
  now: new Date('2026-07-31T12:00:00Z')
}), /unapproved advisory/);

assert.throws(() => evaluatePackagingAudit({
  report: acceptedReport,
  policy,
  lockfile,
  now: new Date('2026-09-01T00:00:00Z')
}), /expired/);

assert.throws(() => evaluatePackagingAudit({
  report: acceptedReport,
  policy,
  lockfile: { packages: { ...lockfile.packages, 'node_modules/brace-expansion': {} } },
  now: new Date('2026-07-31T12:00:00Z')
}), /non-build dependency/);

console.log('Packaging audit policy is fail-closed for scope, advisory, expiry, and runtime reachability.');
