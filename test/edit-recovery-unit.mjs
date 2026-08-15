import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { workspaceReplace } from '../src/localRepoBridge.js';
import { enhanceToolError, serializeToolError } from '../src/tools/errors.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-edit-recovery-'));
const workspace = { alias: 'app', path: root };
const config = { stateDir: path.join(root, '.state') };
const target = path.join(root, 'sample.js');

try {
  fs.writeFileSync(target, [
    'function first() {',
    '  return shared();',
    '}',
    '',
    'function second() {',
    '  return shared();',
    '}',
    ''
  ].join('\n'));

  assert.throws(
    () => workspaceReplace(workspace, config, {
      path: 'sample.js',
      oldText: '  return shared();',
      newText: '  return changed();'
    }),
    error => {
      assert.equal(error.code, 'EDIT_CONTEXT_MISMATCH');
      assert.equal(error.retryable, true);
      assert.equal(error.candidateCount, 2);
      assert.deepEqual(error.matchLines, [2, 6]);
      assert.equal(error.candidateContexts.length, 2);
      assert.match(error.message, /lines 2, 6/);
      assert.match(error.currentSha256, /^[a-f0-9]{64}$/);
      return true;
    }
  );

  let zeroMatchError;
  try {
    workspaceReplace(workspace, config, {
      path: 'sample.js',
      oldText: 'function first() {\n  return shared();\n  console.log("new line");\n}',
      newText: 'function first() {}'
    });
  } catch (error) {
    zeroMatchError = error;
  }
  assert.equal(zeroMatchError?.code, 'EDIT_CONTEXT_MISMATCH');
  assert.equal(zeroMatchError?.candidateCount, 0);
  assert.ok(zeroMatchError?.candidateContexts.length > 0, 'zero-match recovery should return bounded nearby current context when an anchor still exists');

  const enhanced = enhanceToolError('relai_edit', zeroMatchError);
  assert.equal(enhanced.code, 'EDIT_CONTEXT_MISMATCH', 'edit guidance must preserve structured recovery metadata');
  const serialized = serializeToolError('relai_edit', enhanced);
  assert.equal(serialized.errorDetails.code, 'EDIT_CONTEXT_MISMATCH');
  assert.equal(serialized.errorDetails.retryable, true);
  assert.match(serialized.errorDetails.currentSha256, /^[a-f0-9]{64}$/);
  assert.ok(serialized.errorDetails.candidateContexts.length > 0);

  console.log('Exact edit mismatch recovery metadata tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
