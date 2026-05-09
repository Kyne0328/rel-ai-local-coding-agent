import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { applyLoosePatch, isPatchParserError, parseLoosePatch } = require('../src/loosePatch.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-loose-patch-'));
const workspace = { alias: 'tmp', path: root };
fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
fs.writeFileSync(path.join(root, 'lib/example.dart'), [
  'Future<void> run() async {',
  '  if (sender.isEmpty) return;',
  '  await SmsHandlerUtils.sendReply(',
  '    sender,',
  "    'ok',",
  '    smsSender: smsSender,',
  '  );',
  '}',
  ''
].join('\n'));

const malformed = `--- a/lib/example.dart
+++ b/lib/example.dart
@@
- if (sender.isEmpty) return;
+ if (sender.trim().isEmpty) return;
@@ await SmsHandlerUtils.sendReply(
 sender,
 'ok',
 smsSender: smsSender,
+ sourceMessageId: sourceMessageId,
 );
`;

const parsed = parseLoosePatch(malformed);
assert.equal(parsed.files.length, 1);
assert.equal(parsed.files[0].hunks.length, 2);

const result = applyLoosePatch(workspace, malformed, { dryRun: false });
assert.equal(result.ok, true);
assert.equal(result.fallbackApplied, true);
const content = fs.readFileSync(path.join(root, 'lib/example.dart'), 'utf8');
assert.match(content, /sender\.trim\(\)\.isEmpty/);
assert.match(content, /sourceMessageId: sourceMessageId/);
assert.equal(isPatchParserError({ stderr: 'error: patch with only garbage at line 5' }), true);
assert.equal(isPatchParserError({ stderr: 'error: patch failed: file:1' }), false);

console.log('Loose patch smoke passed.');
