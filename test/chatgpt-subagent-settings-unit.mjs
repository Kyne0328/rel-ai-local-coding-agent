import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentStatusView, chatGptAuthView, chatGptBrowserView, formatAgentTimestamp, formatReasoningLabel } from '../src/ui/features/settings/subagents.js';
assert.deepEqual(chatGptAuthView('authentication_saved'), {
  label: 'Sign-in saved',
  tone: 'ok',
  title: 'Verified ChatGPT profile saved',
  description: 'Rel.AI last verified this isolated profile at sign-in and checks authentication again before each delegated agent starts.'
});
assert.equal(chatGptAuthView('authentication_open').tone, 'working');
assert.equal(chatGptAuthView('not_authenticated').label, 'Not signed in');
assert.deepEqual(chatGptBrowserView({ available: true, product: 'Microsoft Edge' }), {
  available: true,
  label: 'Microsoft Edge',
  description: 'Rel.AI will use Microsoft Edge for isolated ChatGPT subagent sessions.'
});
assert.deepEqual(chatGptBrowserView({ available: false }), {
  available: false,
  label: 'Unavailable',
  description: 'Install Chrome, Edge, or Chromium. Rel.AI uses an existing local browser and does not bundle another browser.'
});
assert.equal(formatReasoningLabel('extra_high'), 'Extra High');
assert.equal(formatReasoningLabel('pro'), 'Pro');
assert.deepEqual(agentStatusView('working'), { label: 'Working', tone: 'working' });
assert.deepEqual(agentStatusView('completed'), { label: 'Completed', tone: 'ok' });
assert.deepEqual(agentStatusView('failed'), { label: 'Failed', tone: 'bad' });
assert.equal(formatAgentTimestamp('invalid'), 'Unknown');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/ui/features/settings/subagents.js'), 'utf8');
assert.match(source, /aria-live/);
assert.match(source, /Cookies and credentials are not exposed/);
assert.doesNotMatch(source, /profilePath|document\.cookie|localStorage/);
assert.match(source, /Temporary chats are mandatory/);
assert.match(source, /button\.disabled = true/);
assert.match(source, /button\.onclick = async/);
assert.match(source, /Check browser again/);
assert.match(source, /Install Chrome, Edge, or Chromium/);
assert.match(source, /does not bundle another browser/);
assert.match(source, /Browser runtime/);
assert.doesNotMatch(source, /executablePath|REL_AI_CHATGPT_CHROMIUM_PATH/);
assert.doesNotMatch(source, /statusÎ“Ã‡Âª/);
assert.match(source, /Delegated agents/);
assert.match(source, /Activity unavailable/);
assert.match(source, /Check browser again/);
assert.match(source, /Cancel subagent:/);
assert.match(source, /\/api\/agents\/chatgpt\/cancel/);
assert.match(source, /escapeHtml\(resultSummary\)/);
assert.match(source, /escapeHtml\(error\)/);
assert.doesNotMatch(source, /principalFingerprint|child_work_id|parent_work_id/);
console.log('ChatGPT subagent settings auth, browser prerequisite, activity controls, privacy, and accessibility contracts passed.');