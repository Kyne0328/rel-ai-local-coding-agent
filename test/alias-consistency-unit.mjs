import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { normalizeConfig, publicConfigSummary } from '../src/config.js';
import { buildDiagnosticReport } from '../src/diagnostics.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-command-discovery-'));
try {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      test: 'node test.js',
      lint: 'node lint.js'
    }
  }, null, 2));

  const config = normalizeConfig({
    workspaces: {
      app: {
        path: root,
        commands: { obsolete: 'npm run removed' },
        testCommands: { obsolete: 'npm run removed-test' }
      }
    }
  });
  assert.equal(Object.hasOwn(config.workspaces.app, 'commands'), false);
  assert.equal(Object.hasOwn(config.workspaces.app, 'testCommands'), false);

  const workspace = publicConfigSummary(config).workspaces.find(item => item.alias === 'app');
  assert.deepEqual(workspace.discoveredTestCommandKeys, ['npm:lint', 'npm:test']);
  assert.equal(Object.hasOwn(workspace, 'staleCommandKeys'), false);
  assert.equal(Object.hasOwn(workspace, 'staleTestCommandKeys'), false);

  const report = buildDiagnosticReport({
    workspace: 'app',
    health: { findings: [] },
    connection: { token: 'set', tunnelId: 'configured' },
    connectionState: { publicEndpoint: { status: 'available' } },
    cautionData: { workspaces: [] },
    runtimeLogs: { available: false, entries: [] },
    auditLogs: { entries: [] }
  });
  assert.equal(report.findings.some(item => item.code === 'stale_validation_commands'), false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Manifest-backed command discovery hard-cutover tests passed.');
