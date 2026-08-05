import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveConnectionGenerations } from '../src/mcp/connectionGenerations.js';
import { readRegistry } from '../src/worktreeManager.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-persistence-contract-'));
const worktreeState = path.join(root, 'worktree-state');
const registryFile = path.join(worktreeState, 'worktrees', 'index.json');
const generationFile = path.join(root, 'connection-generations.json');
const generationOptions = {
  file: generationFile,
  key: Buffer.from('contract-key'),
  token: 'token-a',
  host: '127.0.0.1',
  port: 3333,
  publicUrl: 'https://example.ngrok.app'
};
try {
  assert.deepEqual(readRegistry({ stateDir: worktreeState }), { worktrees: {} });
  fs.mkdirSync(path.dirname(registryFile), { recursive: true });
  const validRegistry = { worktrees: { 'repo--feature': { alias: 'repo--feature', path: '/tmp/repo-feature' } } };
  fs.writeFileSync(registryFile, JSON.stringify(validRegistry), 'utf8');
  assert.deepEqual(readRegistry({ stateDir: worktreeState }), validRegistry);

  fs.writeFileSync(`${registryFile}.interrupted.tmp`, '{partial', 'utf8');
  assert.deepEqual(readRegistry({ stateDir: worktreeState }), validRegistry);

  fs.writeFileSync(registryFile, '{malformed', 'utf8');
  fs.writeFileSync(`${registryFile}.bak`, JSON.stringify(validRegistry), 'utf8');
  assert.deepEqual(readRegistry({ stateDir: worktreeState }), { worktrees: {} }, 'current worktree state does not recover its backup');

  fs.writeFileSync(registryFile, JSON.stringify({ worktrees: [] }), 'utf8');
  assert.deepEqual(readRegistry({ stateDir: worktreeState }), { worktrees: [] }, 'structural validation is not yet enforced');

  fs.rmSync(registryFile, { force: true });
  fs.mkdirSync(registryFile);
  assert.deepEqual(readRegistry({ stateDir: worktreeState }), { worktrees: {} }, 'an unavailable primary is currently treated as empty');

  const first = resolveConnectionGenerations({}, generationOptions);
  assert.deepEqual(first, { credentialGeneration: 1, configurationGeneration: 1 });
  const firstSource = fs.readFileSync(generationFile, 'utf8');
  const stable = resolveConnectionGenerations({}, generationOptions);
  assert.deepEqual(stable, first);
  assert.equal(fs.readFileSync(generationFile, 'utf8'), firstSource, 'unchanged generation state avoids a rewrite');
  assert.doesNotMatch(firstSource, /token-a/);

  fs.writeFileSync(`${generationFile}.interrupted.tmp`, '{partial', 'utf8');
  assert.deepEqual(resolveConnectionGenerations({}, generationOptions), stable);

  fs.writeFileSync(generationFile, '{malformed', 'utf8');
  assert.deepEqual(resolveConnectionGenerations({}, generationOptions), { credentialGeneration: 1, configurationGeneration: 1 });
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(generationFile, 'utf8')));

  fs.writeFileSync(generationFile, JSON.stringify({ version: 999, credentialGeneration: 'invalid' }), 'utf8');
  const structurallyInvalid = resolveConnectionGenerations({}, generationOptions);
  assert.equal(Number.isNaN(structurallyInvalid.credentialGeneration), true, 'invalid stored generations currently propagate NaN');
  assert.equal(structurallyInvalid.configurationGeneration, 1);
  assert.equal(JSON.parse(fs.readFileSync(generationFile, 'utf8')).credentialGeneration, null, 'JSON serialization currently persists NaN as null');

  if (process.platform !== 'win32') assert.equal(fs.statSync(generationFile).mode & 0o777, 0o600);

  const blockedParent = path.join(root, 'blocked-parent');
  fs.writeFileSync(blockedParent, 'not a directory', 'utf8');
  assert.throws(
    () => resolveConnectionGenerations({}, { ...generationOptions, file: path.join(blockedParent, 'state.json') }),
    /ENOTDIR|EEXIST|not a directory/i
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Worktree and connection-generation persistence failure contracts passed.');
