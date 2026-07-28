import assert from 'node:assert/strict';

// Access the non-exported helper via re-require with internal eval trick: re-export via test require.
// Easier: re-load module text and detect helper presence by reading the module source. Instead, we
// invoke through relaiApplyPatch's exported path by simulating a converted patch on a fake patch
// rather than calling git. Since normalizeOpenAIPatchFormat is internal, expose via test surface.
import { normalizeOpenAIPatchFormat } from "../src/localRepoBridge.js";

assert.ok(typeof normalizeOpenAIPatchFormat === 'function', 'normalizeOpenAIPatchFormat must be exported');

// 1. Plain unified diff passes through unchanged
{
  const input = `--- a/foo.txt\n+++ b/foo.txt\n@@ -1 +1 @@\n-old\n+new\n`;
  const { patch, converted, sourceFormat } = normalizeOpenAIPatchFormat(input);
  assert.equal(patch, input, 'unified diff must pass through unchanged');
  assert.equal(converted, false, 'unified diff must not be marked converted');
  assert.equal(sourceFormat, 'unified-diff');
}

// 2. OpenAI Update File converts to unified diff with --- a/ and +++ b/ headers
{
  const input = `*** Begin Patch\n*** Update File: lib/foo.dart\n@@ context\n-old\n+new\n*** End Patch\n`;
  const { patch, converted, sourceFormat } = normalizeOpenAIPatchFormat(input);
  assert.equal(converted, true, 'openai patch must be marked converted');
  assert.equal(sourceFormat, 'openai-patch');
  assert.ok(patch.includes('--- a/lib/foo.dart'), 'must emit --- a/ header');
  assert.ok(patch.includes('+++ b/lib/foo.dart'), 'must emit +++ b/ header');
  assert.ok(patch.includes('@@ context'), 'must preserve hunk header');
  assert.ok(patch.includes('-old'), 'must preserve removed line');
  assert.ok(patch.includes('+new'), 'must preserve added line');
}

// 3. OpenAI Add File emits /dev/null source and synthesizes hunk header
{
  const input = `*** Begin Patch\n*** Add File: lib/new.dart\n+line1\n+line2\n*** End Patch\n`;
  const { patch, converted } = normalizeOpenAIPatchFormat(input);
  assert.equal(converted, true);
  assert.ok(patch.includes('--- /dev/null'), 'add file must use /dev/null source');
  assert.ok(patch.includes('+++ b/lib/new.dart'), 'add file must emit destination');
  assert.ok(/@@ -0,0 \+1,2 @@/.test(patch), 'add file must synthesize hunk header with line count');
  assert.ok(patch.includes('+line1'), 'add file content preserved');
  assert.ok(patch.includes('+line2'), 'add file content preserved');
}

// 4. Delete File cannot be converted to a unified diff helper; callers should pass
// the structured patch directly to relai_edit, which handles deletion natively.
{
  const input = `*** Begin Patch\n*** Delete File: lib/old.dart\n*** End Patch\n`;
  assert.throws(
    () => normalizeOpenAIPatchFormat(input),
    /structured OpenAI patch directly to relai_edit updateText/,
    'Delete File must direct callers to the active relai_edit path'
  );
}

// 5. Multiple Update File blocks are concatenated
{
  const input = `*** Begin Patch\n*** Update File: a.txt\n@@\n-1\n+2\n*** Update File: b.txt\n@@\n-3\n+4\n*** End Patch\n`;
  const { patch, converted } = normalizeOpenAIPatchFormat(input);
  assert.equal(converted, true);
  assert.ok(patch.includes('--- a/a.txt'));
  assert.ok(patch.includes('--- a/b.txt'));
  assert.ok(patch.includes('+++ b/a.txt'));
  assert.ok(patch.includes('+++ b/b.txt'));
}

// 6. Empty / null input → returns empty patch, not converted, no throw
{
  const { patch, converted } = normalizeOpenAIPatchFormat('');
  assert.equal(patch, '');
  assert.equal(converted, false);
}

console.log('openai-patch-format unit tests passed.');
