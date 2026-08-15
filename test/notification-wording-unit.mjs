import assert from 'node:assert/strict';

import { buildCompletionNotification, buildFailureNotification, cleanNotificationText, truncateNotificationText } from "../electron/tool-sleep-blocker.js";

assert.equal(cleanNotificationText('  line one\n  line two  '), 'line one line two');
assert.equal(truncateNotificationText('abcdef', 4), 'abc…');

const failure = buildFailureNotification({
  operation: 'Running release checks',
  workspace: 'rel-ai-mcp',
  error: 'Lint failed\nOpen the dashboard for details.'
});
assert.ok(String(failure.title || '').trim(), 'failure notification must have a title');
assert.match(failure.body, /Running release checks/);
assert.match(failure.body, /rel-ai-mcp/);
assert.match(failure.body, /Lint failed/);
assert.doesNotMatch(failure.title, /Rel\.AI MCP|Electron/i, 'the OS already supplies the application identity');

const completion = buildCompletionNotification({
  workspace: 'rel-ai-mcp',
  summary: 'Improved desktop notifications and application identity.',
  validationLevel: 'release'
});
assert.ok(String(completion.title || '').trim(), 'completion notification must have a title');
assert.match(completion.body, /Improved desktop notifications and application identity\./);
assert.match(completion.body, /rel-ai-mcp/);
assert.match(completion.body, /release/i);
assert.doesNotMatch(completion.body, /completion reported|ChatGPT explicitly/i);

const longSummary = 'x'.repeat(1000);
const longCompletion = buildCompletionNotification({
  workspace: 'workspace',
  summary: longSummary,
  validationLevel: 'standard'
});
assert.ok(longCompletion.body.length < longSummary.length, 'notification truncation must reduce an oversized summary');
assert.match(longCompletion.body, /Final standard checks passed\.$/, 'validation result must remain visible');

console.log('Notification wording tests passed.');
