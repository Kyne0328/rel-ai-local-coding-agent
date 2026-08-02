import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DurableStateError, readJsonFile, writeJsonAtomic } from '../src/durableState.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-durable-state-'));
const file = path.join(root, 'state.json');

try {
  writeJsonAtomic(file, { revision: 1, value: 'first' }, { backup: true });
  assert.deepEqual(readJsonFile(file), { revision: 1, value: 'first' });

  writeJsonAtomic(file, { revision: 2, value: 'second' }, { backup: true });
  assert.deepEqual(readJsonFile(file), { revision: 2, value: 'second' });
  assert.deepEqual(readJsonFile(`${file}.bak`), { revision: 1, value: 'first' });

  fs.writeFileSync(file, '{truncated', 'utf8');
  let recovery = null;
  const recovered = readJsonFile(file, {
    backup: true,
    onRecovery: details => { recovery = details; }
  });
  assert.deepEqual(recovered, { revision: 1, value: 'first' });
  assert.equal(recovery.reason, 'malformed_json');
  assert.deepEqual(readJsonFile(file), recovered, 'backup recovery must restore the primary record');

  fs.writeFileSync(file, '{}', 'utf8');
  assert.throws(
    () => readJsonFile(file, { validate: value => Number.isInteger(value.revision) }),
    error => error instanceof DurableStateError && error.code === 'DURABLE_STATE_READ_FAILED'
  );

  assert.deepEqual(
    fs.readdirSync(root).filter(name => /\.(?:tmp|old)$/.test(name)),
    [],
    'atomic state writes must not leave temporary promotion artifacts'
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Durable state atomic write, backup recovery, validation, and cleanup tests passed.');
