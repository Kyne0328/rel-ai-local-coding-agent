import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { enhanceToolError } = require('../src/tools.js');

assert.ok(typeof enhanceToolError === 'function', 'enhanceToolError must be exported');

// 1. relai_replace 0 matches → adds fallback hint
{
  const err = enhanceToolError('relai_replace', new Error('relai_replace operation 1 found 0 matches in lib/foo.dart. Re-read the file and use exact current text.'));
  assert.ok(/relai_read/.test(err.message), 'must mention relai_read fallback');
  assert.ok(/relai_write/.test(err.message), 'must mention relai_write fallback');
}

// 2. relai_replace duplicate matches → suggests occurrence
{
  const err = enhanceToolError('relai_replace', new Error('relai_replace operation 1 found 5 matches in lib/foo.dart. Pass occurrence to replace exactly one match'));
  assert.ok(/occurrence/.test(err.message), 'must suggest occurrence arg');
}

// 3. relai_replace IPv6/URL parse failure → transport workaround
{
  const err = enhanceToolError('relai_replace', new Error('ValueError: Invalid IPv6 URL'));
  assert.ok(/Workarounds/.test(err.message), 'must label workarounds section');
  assert.ok(/relai_write/.test(err.message), 'must point to relai_write fallback');
  assert.ok(/relai_apply_update/.test(err.message), 'must point to apply_update fallback');
}

// 4. relai_apply_update corrupt patch → shows accepted formats
{
  const err = enhanceToolError('relai_apply_update', new Error('error: corrupt patch at line 24'));
  assert.ok(/Git unified diff/.test(err.message), 'must show unified diff example');
  assert.ok(/OpenAI patch format/.test(err.message), 'must show OpenAI patch example');
  assert.ok(/\*\*\* Begin Patch/.test(err.message), 'must include literal Begin Patch token');
}

// 5. relai_apply_update no valid paths → format guidance
{
  const err = enhanceToolError('relai_apply_update', new Error('Patch did not contain any valid workspace file paths.'));
  assert.ok(/--- a\//.test(err.message), 'must show header format');
}

// 6. Untouched error type passes through unchanged
{
  const original = new Error('Something else entirely.');
  const err = enhanceToolError('relai_run_checks', original);
  assert.equal(err, original, 'unrecognized errors must pass through');
}

// 7. relai_edit gets same fallback as relai_replace
{
  const err = enhanceToolError('relai_edit', new Error('Invalid IPv6 URL'));
  assert.ok(/relai_write/.test(err.message), 'relai_edit must get the same hint as relai_replace');
}

// 8. relai_clear_files safety block → call-shape guidance
{
  const err = enhanceToolError('relai_clear_files', new Error('Path touches a blocked sensitive path: .env'));
  assert.ok(/Accepted call shapes/.test(err.message), 'must show call-shape guidance');
  assert.ok(/paths: \[/.test(err.message), 'must show paths array shape');
}

console.log('error-enhancer unit tests passed.');
