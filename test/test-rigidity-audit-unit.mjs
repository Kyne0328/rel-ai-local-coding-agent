import assert from 'node:assert/strict';
import { auditPackageJson, auditSource } from '../scripts/audit-test-rigidity.mjs';

assert.equal(auditSource('test/example.mjs', "assert.equal(manifest.toolSurfaceVersion, 43);").length, 1);
assert.equal(auditSource('test/example.mjs', "assert.equal(electronPackage.devDependencies.electron, '43.4.0');").length, 1);
assert.equal(auditSource('test/example.mjs', "assert.equal(win.options.backgroundColor, '#1f2937');").length, 1);
assert.equal(auditSource('test/example.mjs', "assert.match(appCss, /width:\\s*39%/);").length, 1);
assert.equal(auditSource('test/example.mjs', "assert.equal(packageJson.scripts['electron:build'], 'node scripts/electron-package.mjs --mode unpacked');").length, 1);
assert.equal(auditSource('test/example.mjs', "assert.match(filterCss, /min-height:\\s*44px/); // rigidity-ok: WCAG touch target minimum").length, 0);
assert.equal(auditSource('test/example.mjs', "assert.equal(manifest.toolCount, TOOL_NAMES.length);").length, 0);

const packageViolations = auditPackageJson({ scripts: {
  'test:all': 'node test/run-tests.mjs',
  'test:tool-budgets': 'node scripts/measure-tool-surface.mjs',
  'electron:size': 'node scripts/electron-package-size.mjs --strict'
} });
assert.deepEqual(packageViolations.map(item => item.kind).sort(), [
  'misleading-budget-alias',
  'missing-rigidity-audit',
  'strict-size-baseline'
]);

assert.equal(auditPackageJson({ scripts: {
  'test:all': 'npm run audit:test-rigidity && node test/run-tests.mjs',
  'measure:tool-surface': 'node scripts/measure-tool-surface.mjs',
  'electron:size': 'node scripts/electron-package-size.mjs',
  'benchmark:observability': 'node scripts/observability-benchmark.mjs',
  'benchmark:observability:strict': 'node scripts/observability-benchmark.mjs --enforce-thresholds'
} }).length, 0);

console.log('Test rigidity audit rules passed.');
