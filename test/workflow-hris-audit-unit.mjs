import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createValidationPlan } from '../src/bridge/validationPlan.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-hris-audit-'));
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-hris-state-'));
try {
  for (const pkg of ['front-end', 'back-end']) {
    fs.mkdirSync(path.join(root, pkg, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, pkg, 'test'), { recursive: true });
    fs.writeFileSync(path.join(root, pkg, 'package.json'), JSON.stringify({
      name: pkg,
      scripts: {
        test: 'node --test',
        build: 'node -e "void 0"',
        knip: 'node -e "void 0"'
      }
    }));
    fs.writeFileSync(path.join(root, pkg, 'src', 'app.js'), `export const ${pkg.replace('-', '')} = true;\n`);
    fs.writeFileSync(path.join(root, pkg, 'test', 'app.test.js'), 'export {};\n');
  }
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });
  fs.appendFileSync(path.join(root, 'front-end', 'src', 'app.js'), 'export const changed = true;\n');

  const plan = await createValidationPlan(
    { alias: 'hris', path: root, commands: {}, testCommands: {} },
    { stateDir, auditLogPath: path.join(stateDir, 'audit.jsonl') },
    { changedFiles: ['front-end/src/app.js'] }
  );
  assert.equal(plan.recommended, 'focused');
  assert.ok(plan.checks.focused.length >= 1);
  assert.equal(plan.checks.focused.some(check => /back-end/i.test(check)), false, 'frontend work must not select backend validation');
  assert.equal(plan.checks.focused.some(check => /build|knip/i.test(check)), false, 'focused local work must not routinely select build/Knip');
  assert.equal(plan.checks.quick.some(check => /back-end|build|knip/i.test(check)), false, 'quick package validation must stay frontend-local and cheap');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(stateDir, { recursive: true, force: true });
}
console.log('HRIS-equivalent frontend-only workflow audit passed.');