import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { relaiRead } = require(path.join(root, 'src', 'localRepoBridge.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-read-default-'));
const wsRoot = path.join(tmp, 'repo');
fs.mkdirSync(wsRoot, { recursive: true });
// ~300 KB text file (well over the 128 KB connector default, under the 1 MB local default)
const bigLine = 'x'.repeat(99) + '\n';
fs.writeFileSync(path.join(wsRoot, 'big.txt'), bigLine.repeat(3000));

const config = { stateDir: path.join(tmp, 'state') };
const workspace = { alias: 'repo', path: wsRoot };

try {
  // Connector transport: default capped at 128 KB, truncated flag + range hint present.
  const connector = relaiRead(workspace, config, { paths: ['big.txt'] }, { connector: true });
  const connectorItem = connector.items[0];
  assert.equal(connectorItem.truncated, true, 'connector default must truncate a 300 KB file');
  assert.ok(connectorItem.returnedBytes <= 128 * 1024, `expected <=131072 bytes, got ${connectorItem.returnedBytes}`);
  assert.match(connectorItem.hint, /startLine/, 'truncated read must hint at line-range re-reads');

  // Local transport: 1 MB default returns the whole file.
  const local = relaiRead(workspace, config, { paths: ['big.txt'] }, {});
  assert.equal(local.items[0].truncated, false, 'local default must return the full 300 KB file');
  assert.equal(local.items[0].hint, undefined, 'untruncated reads carry no hint');

  // Explicit maxBytes always wins over the connector default.
  const explicit = relaiRead(workspace, config, { paths: ['big.txt'], maxBytes: 200000 }, { connector: true });
  assert.equal(explicit.items[0].truncated, true);
  assert.ok(explicit.items[0].returnedBytes > 128 * 1024, 'explicit maxBytes must override the connector default');
  assert.ok(explicit.items[0].returnedBytes <= 200000);

  console.log('Connector read default unit test passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
