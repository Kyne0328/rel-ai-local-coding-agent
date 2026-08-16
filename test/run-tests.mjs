// Runs the everyday behavior and safety regression suite. Release-only workflow,
// packaging-policy, browser, and implementation-shape checks remain available through
// named npm scripts or direct `node test/<file>` runs instead of blocking every change.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '..');

const files = [
  'repository-staleness-unit.mjs',
  'intelligence-audit-regressions-unit.mjs',
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
  'update-support-policy-http-unit.mjs',
  'electron-dynamic-resource-contract-unit.mjs',
  'electron-product-path-unit.mjs',
  'test-rigidity-audit-unit.mjs',
  'http-auth-smoke.mjs',
  'http-smoke.mjs',
  'ipc-security-unit.mjs',
  'package-size-policy-unit.mjs',
  'safety-paths.mjs',
  'smoke.mjs',
  'task-state-unit.mjs',
  'task-integrity-unit.mjs',
  'task-completion-unit.mjs',
  'task-reconciliation-unit.mjs',
  'atomic-validation-race-unit.mjs',
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
  console.log(`RUN ${name}`);
  const result = await runTest(name);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.exitCode === 0) {
    console.log(`PASS ${name} (${seconds}s)`);
  } else {
    failures.push(name);
    console.error(`FAIL ${name} (${seconds}s)`);
    if (result.error) console.error(result.error.message);
    if (result.stdout) console.error(result.stdout.trim());
    if (result.stderr) console.error(result.stderr.trim());
  }
}

function runTest(name) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(process.execPath, [path.join(testDir, name)], {
        cwd: root,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5 * 60 * 1000
      });
    } catch (error) {
      resolve({ exitCode: null, stdout: '', stderr: '', error });
      return;
    }
    let stdout = '';
    let stderr = '';
    let error = null;
    let settled = false;
    const finish = exitCode => {
      if (settled) return;
      settled = true;
      resolve({ exitCode, stdout, stderr, error });
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', value => { error = value; });
    child.once('close', finish);
  });
}

console.log(`\n${files.length - failures.length}/${files.length} test files passed.`);
if (failures.length) {
  console.error(`Failed: ${failures.join(', ')}`);
  process.exit(1);
}
