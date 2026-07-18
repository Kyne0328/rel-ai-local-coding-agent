import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getCachedRead, getCachedReadEntry, setCachedRead, invalidatePath, invalidateAlias, invalidateAll, cacheStats } = require('../src/sessionCache.js');

function reset() { invalidateAll(); }

reset();
assert.equal(getCachedRead('a', '/x', 1), null);
console.log('1. cold get: OK');

reset();
setCachedRead('a', '/x', 5, 'hello', { sha256: 'abc123', bytes: 9 });
assert.equal(getCachedRead('a', '/x', 5), 'hello');
assert.deepEqual(getCachedReadEntry('a', '/x', 5), { content: 'hello', sha256: 'abc123', bytes: 9 });
console.log('2. hit with metadata: OK');

reset();
setCachedRead('a', '/x', 5, 'hello');
assert.equal(getCachedRead('a', '/x', 6), null);
assert.equal(getCachedRead('a', '/x', 5), null);
console.log('3. mtime mismatch: OK');

reset();
setCachedRead('a', '/x', 1, 'A');
setCachedRead('a', '/y', 1, 'B');
invalidatePath('a', '/x');
assert.equal(getCachedRead('a', '/x', 1), null);
assert.equal(getCachedRead('a', '/y', 1), 'B');
console.log('4. invalidatePath: OK');

reset();
setCachedRead('a', '/x', 1, 'A');
setCachedRead('b', '/x', 1, 'B');
invalidateAlias('a');
assert.equal(getCachedRead('a', '/x', 1), null);
assert.equal(getCachedRead('b', '/x', 1), 'B');
console.log('5. invalidateAlias: OK');

reset();
const big = 'x'.repeat(1024 * 1024 + 1);
setCachedRead('a', '/big', 1, big);
assert.equal(getCachedRead('a', '/big', 1), null);
console.log('6. >1MB not stored: OK');

reset();
for (let i = 0; i < 200; i++) setCachedRead('a', '/p' + i, 1, 'v' + i);
assert.equal(cacheStats().entries, 200);
await new Promise((resolve) => setTimeout(resolve, 2));
assert.equal(getCachedRead('a', '/p0', 1), 'v0');
setCachedRead('a', '/p200', 1, 'v200');
assert.equal(cacheStats().entries, 200);
assert.equal(getCachedRead('a', '/p0', 1), 'v0', 'recently touched survives');
assert.equal(getCachedRead('a', '/p1', 1), null, 'oldest evicted');
assert.equal(getCachedRead('a', '/p200', 1), 'v200');
console.log('7. LRU eviction: OK');

reset();
setCachedRead('a', '/x', 1, 'A');
setCachedRead('b', '/y', 1, 'B');
invalidateAll();
assert.equal(cacheStats().entries, 0);
console.log('8. invalidateAll: OK');

console.log('session-cache unit tests passed.');
