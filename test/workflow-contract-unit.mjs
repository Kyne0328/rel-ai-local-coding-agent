import assert from 'node:assert/strict';

import { WORKFLOW_INTENTS, deterministicActionId, stableJson } from '../src/workflow/contracts.js';

assert.deepEqual(WORKFLOW_INTENTS, ['auto', 'investigation', 'bugfix', 'feature', 'refactor', 'migration', 'cleanup', 'documentation', 'performance', 'review', 'release', 'other']);

const action = { tool: 'relai_validate', action: 'checks', args: { cwd: 'front-end', check: 'npm test' } };
assert.equal(deterministicActionId(action), deterministicActionId(structuredClone(action)));
assert.match(deterministicActionId(action), /^relai_validate:checks:/);
assert.equal(stableJson({ b: 2, a: 1 }), stableJson({ a: 1, b: 2 }), 'stable JSON must remain deterministic for evidence and repeat-call fingerprints');

console.log('Shared task-intent and deterministic fingerprint contracts passed.');
