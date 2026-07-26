import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { relaiGitCommit } = require('../src/repo/gitOps.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-sensitive-auth-'));
const git = (args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
const workspace = { alias: 'repo', path: root, allowedRemotes: [] };
const config = { stateDir: path.join(root, '.state') };
const removeRoot = () => {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error;
  }
};
try {
  git(['init']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Rel AI Test']);
  fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
  git(['add', 'README.md']);
  git(['commit', '-m', 'base']);

  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=secret\n');
  fs.writeFileSync(path.join(root, '.npmrc'), '//registry.example/:_authToken=secret\n');

  const noScope = await relaiGitCommit(workspace, config, { message: 'blocked', allowSecretPaths: true });
  assert.equal(noScope.ok, false);
  assert.deepEqual(noScope.unauthorizedSecretPaths.sort(), ['.env', '.npmrc']);

  const partial = await relaiGitCommit(workspace, config, {
    message: 'partial',
    sensitiveAuthorization: { operation: 'commit', paths: ['.env'], reason: 'User approved the environment file.' }
  });
  assert.equal(partial.ok, false);
  assert.deepEqual(partial.unauthorizedSecretPaths, ['.npmrc']);
  assert.equal(partial.indexRestored, true);

  const dryRun = await relaiGitCommit(workspace, config, {
    message: 'planned',
    dryRun: true,
    paths: ['.env'],
    sensitiveAuthorization: { operation: 'commit', paths: ['.env'], reason: 'User approved this exact file.' }
  });
  assert.equal(dryRun.ok, true);
  assert.deepEqual(dryRun.sensitiveAuthorization.paths, ['.env']);
  assert.equal(dryRun.sensitiveAuthorization.operation, 'commit');
  assert.equal(dryRun.sensitiveAuthorization.reasonProvided, true);

  const allowed = await relaiGitCommit(workspace, config, {
    message: 'authorized',
    sensitiveAuthorization: {
      operation: 'commit',
      paths: ['.env', '.npmrc'],
      reason: 'User explicitly approved both configuration files.'
    }
  });
  assert.equal(allowed.ok, true);
  assert.deepEqual(allowed.sensitiveAuthorization.paths.sort(), ['.env', '.npmrc']);

  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=next\n');
  const legacyExplicit = await relaiGitCommit(workspace, config, {
    message: 'legacy explicit',
    paths: ['.env'],
    allowSecretPaths: true
  });
  assert.equal(legacyExplicit.ok, true);
  assert.equal(legacyExplicit.sensitiveAuthorization.source, 'legacy-explicit-path-compatibility');

  assert.rejects(
    () => relaiGitCommit(workspace, config, {
      message: 'bad operation',
      sensitiveAuthorization: { operation: 'write', paths: ['.env'], reason: 'wrong scope' }
    }),
    /operation must be 'commit'/
  );
  assert.rejects(
    () => relaiGitCommit(workspace, config, {
      message: 'ordinary path',
      sensitiveAuthorization: { operation: 'commit', paths: ['README.md'], reason: 'not sensitive' }
    }),
    /not classified as sensitive/
  );

  console.log('Scoped sensitive authorization passed.');
} finally {
  removeRoot();
}
