import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getCachedRead, setCachedRead, invalidatePath, invalidateAlias, invalidateAll, cacheStats } = require('../src/sessionCache.js');

function reset() { invalidateAll(); }

// 1. Cold get returns null
{
  reset();
  assert.equal(getCachedRead('a', '/x', 1), null);
  console.log('1. cold get: OK');
}

// 2. Set then get with matching mtime returns content
{
  reset();
  setCachedRead('a', '/x', 5, 'hello');
  assert.equal(getCachedRead('a', '/x', 5), 'hello');
  console.log('2. hit: OK');
}

// 3. mtime mismatch returns null and drops entry
{
  reset();
  setCachedRead('a', '/x', 5, 'hello');
  assert.equal(getCachedRead('a', '/x', 6), null);
  assert.equal(getCachedRead('a', '/x', 5), null);
  console.log('3. mtime mismatch: OK');
}

// 4. invalidatePath drops one entry
{
  reset();
  setCachedRead('a', '/x', 1, 'A');
  setCachedRead('a', '/y', 1, 'B');
  invalidatePath('a', '/x');
  assert.equal(getCachedRead('a', '/x', 1), null);
  assert.equal(getCachedRead('a', '/y', 1), 'B');
  console.log('4. invalidatePath: OK');
}

// 5. invalidateAlias drops only that alias
{
  reset();
  setCachedRead('a', '/x', 1, 'A');
  setCachedRead('b', '/x', 1, 'B');
  invalidateAlias('a');
  assert.equal(getCachedRead('a', '/x', 1), null);
  assert.equal(getCachedRead('b', '/x', 1), 'B');
  console.log('5. invalidateAlias: OK');
}

// 6. Files larger than 1 MB are not stored
{
  reset();
  const big = 'x'.repeat(1024 * 1024 + 1);
  setCachedRead('a', '/big', 1, big);
  assert.equal(getCachedRead('a', '/big', 1), null);
  console.log('6. >1MB not stored: OK');
}

// 7. LRU eviction at 201st entry
{
  reset();
  for (let i = 0; i < 200; i++) setCachedRead('a', '/p' + i, 1, 'v' + i);
  assert.equal(cacheStats().entries, 200);
  await new Promise(r => setTimeout(r, 2));
  assert.equal(getCachedRead('a', '/p0', 1), 'v0');
  setCachedRead('a', '/p200', 1, 'v200');
  assert.equal(cacheStats().entries, 200);
  assert.equal(getCachedRead('a', '/p0', 1), 'v0', 'recently touched survives');
  assert.equal(getCachedRead('a', '/p1', 1), null, 'oldest evicted');
  assert.equal(getCachedRead('a', '/p200', 1), 'v200');
  console.log('7. LRU eviction: OK');
}

// 8. invalidateAll clears everything
{
  reset();
  setCachedRead('a', '/x', 1, 'A');
  setCachedRead('b', '/y', 1, 'B');
  invalidateAll();
  assert.equal(cacheStats().entries, 0);
  console.log('8. invalidateAll: OK');
}

console.log('session-cache unit tests passed.');
