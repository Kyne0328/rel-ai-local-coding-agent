import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { relaiVerify } from '../src/bridge/validation.js';
import { buildCheckCatalog } from '../src/workflow/checkCatalog.js';
import { discoverRepositoryTopology } from '../src/workflow/topology.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-validation-parallel-'));
try {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'parallel-validation-fixture',
    private: true,
    scripts: {
      lint: 'node -e "setTimeout(() => process.exit(0), 120)"',
      typecheck: 'node -e "setTimeout(() => process.exit(0), 120)"',
      build: 'node -e "setTimeout(() => process.exit(0), 40)"'
    }
  }, null, 2));

  const topology = discoverRepositoryTopology(root);
  const catalog = buildCheckCatalog(topology);
  const lint = catalog.find(item => item.kind === 'lint');
  const typecheck = catalog.find(item => item.kind === 'typecheck');
  const build = catalog.find(item => item.kind === 'build');
  assert.ok(lint && typecheck && build, 'fixture should expose lint, typecheck, and build checks');

  const result = await relaiVerify(
    { alias: 'repo', path: root, commands: {}, testCommands: {} },
    { stateDir: path.join(root, '.state') },
    { checks: [lint.id, typecheck.id, build.id], timeoutMs: 30000, stopOnFailure: true }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.results.map(item => item.command), [lint.command, typecheck.command, build.command]);
  assert.equal(result.execution.maxParallelism, 2, 'lint and typecheck should overlap while build remains a serial barrier');
  assert.equal(result.execution.stepCount, 3);
  assert.ok(result.execution.parallelTimeSavedMs > 0, 'parallel validation should report saved wall time');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Validation parallelism unit tests passed.');
