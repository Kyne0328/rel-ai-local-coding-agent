import assert from 'node:assert/strict';

import { buildCompletionNotification, buildFailureNotification, cleanNotificationText, truncateNotificationText } from "../electron/tool-sleep-blocker.js";

assert.equal(cleanNotificationText('  line one\n  line two  '), 'line one line two');
assert.equal(truncateNotificationText('abcdef', 4), 'abc…');

const failure = buildFailureNotification({
  operation: 'Running release checks',
  workspace: 'rel-ai-mcp',
  error: 'Lint failed\nOpen the dashboard for details.'
});
assert.deepEqual(failure, {
  title: 'Workspace action failed',
  body: 'Running release checks failed in rel-ai-mcp. Lint failed Open the dashboard for details.'
});
assert.doesNotMatch(failure.title, /Rel\.AI MCP|Electron/i, 'the OS already supplies the application identity');

const completion = buildCompletionNotification({
  workspace: 'rel-ai-mcp',
  summary: 'Improved desktop notifications and application identity.',
  validationLevel: 'release'
});
assert.deepEqual(completion, {
  title: 'Task completed',
  body: 'Improved desktop notifications and application identity. Workspace: rel-ai-mcp. Final release checks passed.'
});
assert.doesNotMatch(completion.body, /completion reported|ChatGPT explicitly/i);

const longCompletion = buildCompletionNotification({
  workspace: 'workspace',
  summary: 'x'.repeat(1000),
  validationLevel: 'standard'
});
assert.ok(longCompletion.body.length <= 260, 'notification bodies must remain concise');
assert.match(longCompletion.body, /Final standard checks passed\.$/, 'validation result must remain visible');

console.log('Notification wording tests passed.');
