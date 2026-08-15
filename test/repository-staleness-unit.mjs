import assert from 'node:assert/strict';
import { auditRepositoryStaleness } from '../scripts/audit-stale-references.mjs';

const result = auditRepositoryStaleness();
assert.equal(result.findings.length, 0, result.findings.map((item) => `${item.file}:${item.line} ${item.rule} ${item.match || item.text}`).join('\n'));
assert.ok(result.scannedFiles >= 30, 'repository staleness audit scanned too few guidance files');
assert.ok(result.invariantCount >= 10, 'repository staleness audit must enforce current-source hard-cutover invariants');
console.log(`Repository staleness audit passed across ${result.scannedFiles} tracked guidance files and ${result.invariantCount} source invariants.`);
