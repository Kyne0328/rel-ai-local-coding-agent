import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeCommandAlias } = require('../src/commandNormalizer.js');

const discovered = {
  'npm:test': 'npm test',
  'npm:lint': 'npm run lint',
  'go:test': 'go test ./...'
};

// 1. Falsy value → warning, command = key
{
  const r = normalizeCommandAlias('mykey', '', discovered);
  assert.equal(r.normalized, false, 'falsy: normalized must be false');
  assert.equal(r.command, 'mykey', 'falsy: command falls back to key');
  assert.ok(r.warning, 'falsy: must have warning');
}

// 2. Value already matches a discovered command value → use as-is, no warning
{
  const r = normalizeCommandAlias('something', 'npm test', discovered);
  assert.equal(r.normalized, false, 'canonical: normalized must be false');
  assert.equal(r.command, 'npm test', 'canonical: command unchanged');
  assert.equal(r.warning, undefined, 'canonical: no warning');
}

// 3. Key matches a discovered key → normalize to canonical form
{
  const r = normalizeCommandAlias('npm:lint', 'old-lint-command', discovered);
  assert.equal(r.normalized, true, 'key-match: normalized must be true');
  assert.equal(r.command, 'npm run lint', 'key-match: command is the discovered canonical form');
  assert.equal(r.originalValue, 'old-lint-command', 'key-match: originalValue preserved');
  assert.equal(r.warning, undefined, 'key-match: no warning');
}

// 4. Value starts with recognized runnable prefix → use as-is, no warning
{
  const r = normalizeCommandAlias('check', 'pytest --fast', discovered);
  assert.equal(r.normalized, false, 'runnable: normalized must be false');
  assert.equal(r.command, 'pytest --fast', 'runnable: command unchanged');
  assert.equal(r.warning, undefined, 'runnable: no warning');
}

// 5. Unknown/stale key, unrecognized value → warning present
{
  const r = normalizeCommandAlias('old-renamed-key', 'some-obsolete-tool --run', discovered);
  assert.equal(r.normalized, false, 'stale: normalized must be false');
  assert.equal(r.command, 'some-obsolete-tool --run', 'stale: command unchanged');
  assert.ok(r.warning, 'stale: must have warning');
}

console.log('commandNormalizer unit tests passed.');
