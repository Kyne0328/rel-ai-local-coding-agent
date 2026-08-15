// Runs the small release-critical regression suite. Broader focused tests remain
// available through their named npm scripts and direct `node test/<file>` runs,
// but they do not block every release by default.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '..');

const files = [
  'repository-staleness-unit.mjs',
  'tunnel-credentials-unit.mjs',
  'secure-tunnel-runtime-unit.mjs',
  'secure-tunnel-packaging-contract-unit.mjs',
  'authorization-policy-unit.mjs',
  'connector-result-contract-unit.mjs',
  'desktop-lifecycle-unit.mjs',
  'desktop-settings-unit.mjs',
  'dashboard-session-unit.mjs',
  'durable-state-unit.mjs',
  'electron-updater-config-unit.mjs',
  'update-support-policy-unit.mjs',
  'update-support-policy-integration-unit.mjs',
  'update-support-policy-http-unit.mjs',
  'electron-dynamic-resource-contract-unit.mjs',
  'electron-product-path-unit.mjs',
  'frontend-streamlining-contract-unit.mjs',
  'http-auth-smoke.mjs',
  'http-smoke.mjs',
  'ipc-security-unit.mjs',
  'package-size-policy-unit.mjs',
  'release-workflow-smoke.mjs',
  'safety-paths.mjs',
  'smoke.mjs',
  'task-state-unit.mjs',
  'task-integrity-unit.mjs',
  'task-completion-unit.mjs',
  'parallel-task-sandbox-unit.mjs',
  'process-manager-unit.mjs',
  'baseline-tracking-unit.mjs',
  'unborn-workspace-unit.mjs',
  'validation-task-scope-unit.mjs',
  'workflow-benchmark-contract-unit.mjs',
  'edit-run-checks-completion-unit.mjs',
  'edit-recovery-unit.mjs',
  'exec-dirty-mutation-unit.mjs',
  'exec-tool-unit.mjs',
  'tool-failure-accounting-unit.mjs',
  'tool-action-contract-unit.mjs',
  'tool-output-validation-unit.mjs',
  'local-analytics-unit.mjs',
  'analytics-reliability-unit.mjs',
  'repo-health.mjs',
  'web-automation-contract-unit.mjs',
  'window-security-unit.mjs'
];

const failures = [];
for (const name of files) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [path.join(testDir, name)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5 * 60 * 1000
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (res.status === 0) {
    console.log(`PASS ${name} (${seconds}s)`);
  } else {
    failures.push(name);
    console.error(`FAIL ${name} (${seconds}s)`);
    if (res.stdout) console.error(res.stdout.trim());
    if (res.stderr) console.error(res.stderr.trim());
  }
}

console.log(`\n${files.length - failures.length}/${files.length} test files passed.`);
if (failures.length) {
  console.error(`Failed: ${failures.join(', ')}`);
  process.exit(1);
}
