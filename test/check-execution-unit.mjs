import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildCheckCatalog, classifyCheckKind } from '../src/workflow/checkCatalog.js';
import { buildCheckExecutionStages, checkExecutionPolicy } from '../src/workflow/checkExecution.js';
import { discoverRepositoryTopology } from '../src/workflow/topology.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-check-execution-'));
try {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'check-execution-fixture',
    private: true,
    scripts: {
      lint: 'eslint .',
      'lint:fix': 'eslint . --fix',
      typecheck: 'tsc --noEmit',
      test: 'vitest run',
      'test:all': 'npm run lint && npm run typecheck',
      'config:add': 'node bin/config.js workspace add',
      build: 'vite build'
    }
  }, null, 2));

  const catalog = buildCheckCatalog(discoverRepositoryTopology(root));
  const byName = name => catalog.find(item => item.id.endsWith(`:${name}`));
  const lint = byName('lint');
  const lintFix = byName('lint:fix');
  const typecheck = byName('typecheck');
  const test = byName('test');
  const testAll = byName('test:all');
  const configAdd = byName('config:add');
  const build = byName('build');

  assert.equal(classifyCheckKind('test:all', 'npm run lint && npm run typecheck'), 'test', 'script identity must win over nested tool names');
  assert.equal(configAdd.kind, 'other', 'configuration commands must not become validation checks');
  assert.equal(checkExecutionPolicy(lint).parallelSafe, true);
  assert.equal(checkExecutionPolicy(typecheck).parallelSafe, true);
  assert.equal(checkExecutionPolicy(lintFix).parallelSafe, false, 'mutating npm script bodies must stay serial');
  assert.equal(checkExecutionPolicy(test).parallelSafe, false, 'tests are not side-effect-free by default');
  assert.equal(checkExecutionPolicy(testAll).parallelSafe, false, 'composite test scripts must stay serial');
  assert.equal(checkExecutionPolicy(build).parallelSafe, false);
  assert.equal(
    checkExecutionPolicy({ command: 'npm run lint', kind: 'lint', scopeKey: 'package:root' }).parallelSafe,
    false,
    'unresolved npm wrappers must default to serial instead of trusting their names'
  );
  assert.equal(checkExecutionPolicy({ command: 'npm run lint:fix', scopeKey: 'repository' }).parallelSafe, false);
  assert.equal(checkExecutionPolicy({ command: 'npm run test:update', scopeKey: 'repository' }).parallelSafe, false);
  assert.equal(checkExecutionPolicy({ command: 'eslint . --fix', kind: 'lint', scopeKey: 'repository' }).parallelSafe, false);
  assert.equal(checkExecutionPolicy({ command: 'eslint .', kind: 'lint', scopeKey: 'repository' }).parallelSafe, true);

  const stages = buildCheckExecutionStages([lint, typecheck, test, build]);
  assert.equal(stages.length, 3);
  assert.equal(stages[0].parallel, true);
  assert.deepEqual(stages[0].items.map(item => item.policy.kind), ['lint', 'typecheck']);
  assert.equal(stages[1].parallel, false, 'test should be a serial barrier');
  assert.equal(stages[2].parallel, false, 'build should be a serial barrier');

  const unknown = checkExecutionPolicy({ command: 'node custom-check.js', kind: 'other', scopeKey: 'repository' });
  assert.equal(unknown.parallelSafe, false, 'unknown commands must stay serial by default');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Check execution policy resolves real script bodies and keeps mutation-capable work serial.');
