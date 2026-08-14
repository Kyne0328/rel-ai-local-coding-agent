import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatGptAuthView, formatReasoningLabel } from '../src/ui/features/settings/subagents.js';
assert.deepEqual(chatGptAuthView('authentication_saved'), {
  label: 'Sign-in saved',
  tone: 'ok',
  title: 'Verified ChatGPT profile saved',
  description: 'Rel.AI last verified this isolated profile at sign-in and checks authentication again before each delegated agent starts.'
});
assert.equal(chatGptAuthView('authentication_open').tone, 'working');
assert.equal(chatGptAuthView('not_authenticated').label, 'Not signed in');
assert.equal(formatReasoningLabel('extra_high'), 'Extra High');
assert.equal(formatReasoningLabel('pro'), 'Pro');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/ui/features/settings/subagents.js'), 'utf8');
assert.match(source, /aria-live/);
assert.match(source, /Cookies and credentials are not exposed/);
assert.doesNotMatch(source, /profilePath|document\.cookie|localStorage/);
assert.match(source, /Temporary chats are mandatory/);
assert.match(source, /button\.disabled = true/);
assert.match(source, /button\.onclick = async/);
console.log('ChatGPT subagent settings status, reasoning labels, privacy copy, and action-state contracts passed.');