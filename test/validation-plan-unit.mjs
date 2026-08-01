import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { createValidationPlan, readValidationPlan } from "../src/bridge/validationPlan.js";
import { relaiVerify } from '../src/bridge/validation.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-validation-plan-'));
const stateDir = path.join(root, 'state');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
git('init');
git('config', 'user.email', 'relai@example.test');
git('config', 'user.name', 'RelAI Test');
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.mkdirSync(path.join(root, 'test'), { recursive: true });
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { check: 'node --check src/app.js', test: 'node test/app.test.js' } }, null, 2));
fs.writeFileSync(path.join(root, 'src', 'app.js'), 'module.exports = () => 1;\n');
fs.writeFileSync(path.join(root, 'test', 'app.test.js'), "require('../src/app')();\n");
git('add', '.');
git('commit', '-m', 'fixture');
fs.writeFileSync(path.join(root, 'src', 'app.js'), 'module.exports = () => 2;\n');
const workspace = { alias: 'app', path: root, testCommands: {}, commands: {} };
const config = { stateDir };

try {
  const plan = await createValidationPlan(workspace, config, {});
  assert.equal(plan.ok, true);
  assert.match(plan.planId, /^vplan_/);
  assert.ok(plan.changedFiles.includes('src/app.js'));
  assert.ok(plan.checks.quick.length > 0);
  const loaded = readValidationPlan(config, plan.planId, workspace);
  assert.equal(loaded.signature, plan.signature);

  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'module.exports = () => 3;\n');
  await assert.rejects(
    () => relaiVerify(workspace, config, { planId: plan.planId, planLevel: 'quick' }),
    /stale because relevant workspace content changed/i
  );

  const file = path.join(stateDir, 'validation-plans', `${plan.planId}.json`);
  const tampered = JSON.parse(fs.readFileSync(file, 'utf8'));
  tampered.recommended = 'release';
  fs.writeFileSync(file, JSON.stringify(tampered, null, 2));
  assert.throws(() => readValidationPlan(config, plan.planId, workspace), /signature is invalid/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Signed validation-plan creation and tamper detection tests passed.');
