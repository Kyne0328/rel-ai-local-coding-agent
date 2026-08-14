import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableStateError } from '../src/durableState.js';
import { resolveConnectionGenerations } from '../src/mcp/connectionGenerations.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-persistence-contract-'));
const generationFile = path.join(root, 'connection-generations.json');
const generationOptions = {
  file: generationFile,
  key: Buffer.from('contract-key'),
  token: 'token-a',
  host: '127.0.0.1',
  port: 3333
};

try {
  const first = resolveConnectionGenerations({}, generationOptions);
  assert.deepEqual(first, { credentialGeneration: 1, configurationGeneration: 1 });
  const firstSource = fs.readFileSync(generationFile, 'utf8');
  const stable = resolveConnectionGenerations({}, generationOptions);
  assert.deepEqual(stable, first);
  assert.equal(fs.readFileSync(generationFile, 'utf8'), firstSource, 'unchanged generation state avoids a rewrite');
  assert.doesNotMatch(firstSource, /token-a/);

  fs.writeFileSync(`${generationFile}.interrupted.tmp`, '{partial', 'utf8');
  assert.deepEqual(resolveConnectionGenerations({}, generationOptions), stable);

  const changedOptions = { ...generationOptions, token: 'token-b' };
  const changed = resolveConnectionGenerations({}, changedOptions);
  assert.deepEqual(changed, { credentialGeneration: 2, configurationGeneration: 1 });
  const backupBeforeRecovery = JSON.parse(fs.readFileSync(`${generationFile}.bak`, 'utf8'));
  assert.equal(backupBeforeRecovery.credentialGeneration, 1);

  fs.writeFileSync(generationFile, '{malformed', 'utf8');
  assert.deepEqual(resolveConnectionGenerations({}, changedOptions), changed, 'malformed primary must recover the prior valid generation and preserve increment rules');
  assert.deepEqual(JSON.parse(fs.readFileSync(generationFile, 'utf8')).credentialGeneration, 2);

  fs.writeFileSync(generationFile, '{malformed', 'utf8');
  fs.writeFileSync(`${generationFile}.bak`, '{also-malformed', 'utf8');
  assert.throws(
    () => resolveConnectionGenerations({}, changedOptions),
    error => error instanceof DurableStateError
      && error.code === 'DURABLE_STATE_READ_FAILED'
      && error.details.path === path.resolve(generationFile)
      && error.details.reason === 'malformed_json'
      && error.details.backupAttempted === true
      && error.details.backupReason === 'malformed_json'
  );

  fs.writeFileSync(generationFile, JSON.stringify({ version: 999, credentialGeneration: 'invalid' }), 'utf8');
  fs.rmSync(`${generationFile}.bak`, { force: true });
  assert.throws(
    () => resolveConnectionGenerations({}, generationOptions),
    error => error instanceof DurableStateError
      && error.details.reason === 'validation_failed'
      && error.details.backupReason === 'missing'
  );

  if (process.platform !== 'win32') assert.equal(fs.statSync(generationFile).mode & 0o777, 0o600);

  const blockedParent = path.join(root, 'blocked-parent');
  fs.writeFileSync(blockedParent, 'not a directory', 'utf8');
  const blockedFile = path.join(blockedParent, 'state.json');
  assert.throws(
    () => resolveConnectionGenerations({}, { ...generationOptions, file: blockedFile }),
    error => error instanceof DurableStateError
      && error.code === 'DURABLE_STATE_WRITE_FAILED'
      && error.details.path === path.resolve(blockedFile)
      && Boolean(error.details.fsCode)
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Connection-generation persistence failure contracts passed.');
