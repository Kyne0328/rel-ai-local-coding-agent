import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { requestStateKey } from '../src/mcp/context.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-request-state-key-'));
const config = { stateDir: root };
const file = path.join(root, 'request-state.key');

try {
  const generated = requestStateKey(config);
  assert.ok(Buffer.byteLength(generated, 'utf8') >= 32);
  assert.equal(requestStateKey(config), generated, 'request-state signing identity must survive repeated reads');

  fs.writeFileSync(file, 'truncated', 'utf8');
  const recovered = requestStateKey(config);
  assert.notEqual(recovered, 'truncated');
  assert.ok(Buffer.byteLength(recovered, 'utf8') >= 32);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), recovered);
  assert.deepEqual(
    fs.readdirSync(root).filter(name => /\.(?:tmp|old)$/.test(name)),
    [],
    'request-state key replacement must not leave promotion artifacts'
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Request-state signing key durability and truncated-key recovery tests passed.');
