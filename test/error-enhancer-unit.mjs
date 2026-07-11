import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { enhanceToolError } = require('../src/tools.js');

assert.ok(typeof enhanceToolError === 'function');

{
  const error = enhanceToolError('relai_replace', new Error('relai_replace operation 1 found 0 matches in lib/foo.dart.'));
  assert.match(error.message, /relai_read/);
  assert.match(error.message, /relai_edit with content/);
}

{
  const error = enhanceToolError('relai_replace', new Error('relai_replace operation 1 found 5 matches in lib/foo.dart.'));
  assert.match(error.message, /occurrence/);
}

{
  const error = enhanceToolError('relai_edit', new Error('ValueError: Invalid IPv6 URL'));
  assert.match(error.message, /content, updateText/);
}

for (const message of ['error: corrupt patch at line 24', 'Patch did not contain any valid workspace file paths.']) {
  const error = enhanceToolError('relai_edit', new Error(message));
  assert.match(error.message, /Git unified diff/);
  assert.match(error.message, /structured OpenAI patch format/);
}

{
  const error = enhanceToolError('relai_edit', new Error('OpenAI patch context mismatch.'));
  assert.match(error.message, /Re-read the file/);
}

{
  const original = new Error('Something else entirely.');
  assert.equal(enhanceToolError('relai_run_checks', original), original);
}

console.log('Error enhancer unit tests passed for active tools.');
