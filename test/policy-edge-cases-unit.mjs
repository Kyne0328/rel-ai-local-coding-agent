import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolvePolicy, readSessionPolicy, writeSessionPolicy, clearSessionPolicy } = require('../src/policyResolver.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-policy-edge-'));
const config = { stateDir: TMP };
const ALIAS = 'edge-ws';

function sessionPath(alias) { return path.join(TMP, 'sessions', `${alias}-policy.json`); }

function ensureSessionsDir() { fs.mkdirSync(path.join(TMP, 'sessions'), { recursive: true }); }

function clear() { fs.rmSync(sessionPath(ALIAS), { force: true }); }

// 1. resolvePolicy with no session -> inactive
{
  clear();
  const p = resolvePolicy({ alias: ALIAS }, config);
  assert.equal(p.sessionActive, false);
  assert.equal(p.source, 'default');
  assert.equal(p.trusted, true);
  console.log('1. no session: OK');
}

// 2. resolvePolicy with workspace as plain string
{
  clear();
  const p = resolvePolicy(ALIAS, config);
  assert.equal(p.sessionActive, false);
  console.log('2. string workspace: OK');
}

// 3. resolvePolicy with null workspace -> alias becomes empty string, returns inactive
{
  const p = resolvePolicy(null, config);
  assert.equal(p.sessionActive, false);
  console.log('3. null workspace: OK');
}

// 4. resolvePolicy with workspace missing alias property -> coerced to "[object Object]" -> inactive
{
  const p = resolvePolicy({}, config);
  assert.equal(p.sessionActive, false);
  console.log('4. workspace no alias: OK');
}

// 5. Corrupt JSON session file -> readSessionPolicy returns null, resolve inactive
{
  ensureSessionsDir();
  fs.writeFileSync(sessionPath(ALIAS), '{not json', 'utf8');
  assert.equal(readSessionPolicy(config, ALIAS), null);
  const p = resolvePolicy({ alias: ALIAS }, config);
  assert.equal(p.sessionActive, false);
  console.log('5. corrupt JSON: OK');
}

// 6. Array root rejected (Phase 2 fix) -> inactive
{
  ensureSessionsDir();
  fs.writeFileSync(sessionPath(ALIAS), '[1,2,3]', 'utf8');
  assert.equal(readSessionPolicy(config, ALIAS), null);
  const p = resolvePolicy({ alias: ALIAS }, config);
  assert.equal(p.sessionActive, false);
  console.log('6. array root: OK');
}

// 7. Empty object {} -> readSessionPolicy returns {} (truthy), session treated active with null createdAt
{
  ensureSessionsDir();
  fs.writeFileSync(sessionPath(ALIAS), '{}', 'utf8');
  const p = resolvePolicy({ alias: ALIAS }, config);
  assert.equal(p.sessionActive, true);
  assert.equal(p.sessionCreatedAt, null);
  assert.equal(p.taskHint, null);
  assert.equal(p.source, 'session_file');
  console.log('7. empty object: OK');
}

// 8. writeSessionPolicy then resolve -> sessionActive true with createdAt
{
  clear();
  writeSessionPolicy(config, ALIAS, { taskHint: 'fix bug' });
  const p = resolvePolicy({ alias: ALIAS }, config);
  assert.equal(p.sessionActive, true);
  assert.equal(p.taskHint, 'fix bug');
  assert.match(p.sessionCreatedAt, /^\d{4}-\d{2}-\d{2}T/);
  console.log('8. write then resolve: OK');
}

// 9. clearSessionPolicy removes file
{
  clear();
  writeSessionPolicy(config, ALIAS, {});
  const r = clearSessionPolicy(config, ALIAS);
  assert.equal(r.cleared, true);
  const p = resolvePolicy({ alias: ALIAS }, config);
  assert.equal(p.sessionActive, false);
  console.log('9. clear removes: OK');
}

// 10. clearSessionPolicy when no file -> cleared: false
{
  clear();
  const r = clearSessionPolicy(config, ALIAS);
  assert.equal(r.cleared, false);
  console.log('10. clear no file: OK');
}

// 11. Numeric primitive at root -> rejected
ensureSessionsDir();
fs.writeFileSync(sessionPath(ALIAS), '42', 'utf8');
assert.equal(readSessionPolicy(config, ALIAS), null);
console.log('11. numeric root: OK');

// 12. String primitive at root -> rejected
ensureSessionsDir();
fs.writeFileSync(sessionPath(ALIAS), '"sneaky"', 'utf8');
assert.equal(readSessionPolicy(config, ALIAS), null);
console.log('12. string root: OK');

// 13. null at root -> rejected
ensureSessionsDir();
fs.writeFileSync(sessionPath(ALIAS), 'null', 'utf8');
assert.equal(readSessionPolicy(config, ALIAS), null);
console.log('13. null root: OK');

// Cleanup
clear();
fs.rmSync(path.join(TMP, 'sessions'), { recursive: true, force: true });
fs.rmSync(TMP, { recursive: true, force: true });

console.log('policy edge-cases unit tests passed.');
