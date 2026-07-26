import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runEnvOperation } = require('../src/envOperations.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-env-operations-'));
const workspace = { alias: 'repo', path: root };
const config = { stateDir: path.join(root, '.state') };
const envPath = path.join(root, '.env');
try {
  fs.writeFileSync(envPath, '# local\nAPI_KEY=top-secret\nPORT=3000\nAPI_KEY=duplicate\ninvalid line\n', { mode: 0o600 });
  fs.writeFileSync(path.join(root, '.env.example'), 'API_KEY=\nPORT=\nDATABASE_URL=\n');

  const listed = runEnvOperation(workspace, config, { envAction: 'list', path: '.env' });
  assert.deepEqual(listed.keys, ['API_KEY', 'PORT']);
  assert.deepEqual(listed.malformedLines, [5]);
  assert.equal(listed.valuesReturned, false);
  assert.match(listed.sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(listed), /top-secret|3000|duplicate/);

  const compared = runEnvOperation(workspace, config, { envAction: 'compare', path: '.env', templatePath: '.env.example' });
  assert.deepEqual(compared.missingKeys, ['DATABASE_URL']);
  assert.deepEqual(compared.extraKeys, []);
  assert.doesNotMatch(JSON.stringify(compared), /top-secret/);

  const setResult = runEnvOperation(workspace, config, { envAction: 'set', path: '.env', key: 'API_KEY', value: 'replacement', expectedSha256: listed.sha256 });
  assert.equal(setResult.changed, true);
  assert.equal(setResult.valuesReturned, false);
  const afterSet = fs.readFileSync(envPath, 'utf8');
  assert.equal((afterSet.match(/^API_KEY=/gm) || []).length, 1);
  assert.match(afterSet, /^API_KEY=replacement$/m);
  assert.doesNotMatch(JSON.stringify(setResult), /replacement|top-secret/);

  assert.throws(
    () => runEnvOperation(workspace, config, { envAction: 'set', path: '.env', key: 'STALE', value: 'hidden', expectedSha256: listed.sha256 }),
    /stale expectedSha256/
  );

  const removed = runEnvOperation(workspace, config, { envAction: 'remove', path: '.env', key: 'PORT' });
  assert.equal(removed.presentBefore, true);
  assert.equal(removed.presentAfter, false);
  assert.doesNotMatch(fs.readFileSync(envPath, 'utf8'), /^PORT=/m);

  const dryRun = runEnvOperation(workspace, config, { envAction: 'set', path: '.env', key: 'DRY_RUN', value: 'hidden', dryRun: true });
  assert.equal(dryRun.changed, true);
  assert.equal(dryRun.changedFiles.length, 0);
  assert.doesNotMatch(fs.readFileSync(envPath, 'utf8'), /^DRY_RUN=/m);
  assert.doesNotMatch(JSON.stringify(dryRun), /hidden/);

  assert.throws(() => runEnvOperation(workspace, config, { envAction: 'set', path: '.env', key: 'BAD-KEY', value: 'x' }), /must match/);
  assert.throws(() => runEnvOperation(workspace, config, { envAction: 'set', path: '.env', key: 'GOOD', value: 'a\nb' }), /single-line/);
  assert.throws(() => runEnvOperation(workspace, config, { envAction: 'list', path: 'credentials/token.txt' }), /blocked sensitive path/);

  console.log('Targeted environment operations passed without value disclosure.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
