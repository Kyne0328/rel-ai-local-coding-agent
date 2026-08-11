import assert from 'node:assert/strict';

import { classifyWorkflowRisk } from '../src/workflow/risk.js';
import { selectValidationLevel } from '../src/validationStrategy.js';

const cases = [
  [['README.md'], 'file', 'low'],
  [['front-end/src/app.js'], 'package', 'medium'],
  [['types/boundaries.d.ts'], 'cross_package', 'high'],
  [['front-end/package.json'], 'package', 'high'],
  [['.github/workflows/release.yml'], 'release', 'high'],
  [['src/tools/outputSchemas.js'], 'repository', 'high']
];
for (const [changedFiles, boundary, risk] of cases) {
  const result = classifyWorkflowRisk({ changedFiles, packageIds: changedFiles[0].startsWith('front-end/') ? ['npm:front-end'] : [] });
  assert.equal(result.boundary.level, boundary, changedFiles[0]);
  assert.equal(result.risk.level, risk, changedFiles[0]);
}
const migration = classifyWorkflowRisk({ changedFiles: ['db/schema.sql'], operation: { kind: 'migration' } });
assert.equal(migration.boundary.level, 'repository');
assert.equal(migration.risk.level, 'critical');

const manyLocal = classifyWorkflowRisk({ changedFiles: Array.from({ length: 40 }, (_, index) => `front-end/src/${index}.js`), packageIds: ['npm:front-end'] });
assert.equal(manyLocal.boundary.level, 'package', 'file count alone must not escalate boundary');
assert.equal(manyLocal.risk.level, 'medium');

const selected = selectValidationLevel('.', {}, '', Array.from({ length: 40 }, (_, index) => 'front-end/src/' + index + '.js'), { packageIds: ['npm:front-end'] });
assert.equal(selected.level, 'focused');

console.log('Shared workflow boundary and risk classification tests passed.');