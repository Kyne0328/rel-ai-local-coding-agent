import assert from 'node:assert/strict';

import { taskProgressHtml } from '../src/ui/components/task-progress.js';

const indeterminate = { mode: 'indeterminate', label: 'Running command' };

for (const [status, className, state, fallback] of [
  ['failed', 'static terminal failed', 'Failed', 'Task failed'],
  ['cancelled', 'static terminal cancelled', 'Ended', 'Task ended without completion'],
  ['inactive', 'static terminal cancelled', 'Ended', 'Task ended without completion'],
  ['expired', 'static terminal cancelled', 'Ended', 'Task ended without completion']
]) {
  const html = taskProgressHtml(indeterminate, status);
  assert.match(html, new RegExp(className.replaceAll(' ', '\\s+')));
  assert.match(html, new RegExp(`>${state}<`));
  assert.match(html, new RegExp(fallback));
  assert.doesNotMatch(html, /indeterminate/);
  assert.doesNotMatch(html, /task-progress-track/);
  assert.doesNotMatch(html, /Running command/);
}

for (const [status, className, state] of [
  ['validation_failed', 'static paused failed', 'Action required'],
  ['blocked', 'static paused blocked', 'Action required'],
  ['waiting_for_approval', 'static paused approval', 'Paused']
]) {
  const html = taskProgressHtml({ mode: 'indeterminate', label: 'Approval required' }, status, { compact: true });
  assert.match(html, new RegExp(className.replaceAll(' ', '\\s+')));
  assert.match(html, new RegExp(`>${state}<`));
  assert.doesNotMatch(html, /indeterminate/);
  assert.doesNotMatch(html, /task-progress-track/);
}

const running = taskProgressHtml(indeterminate, 'running');
assert.match(running, /task-progress indeterminate/);
assert.match(running, /task-progress-track/);

const completed = taskProgressHtml({ mode: 'complete', label: 'Complete' }, 'completed');
assert.match(completed, /task-progress complete/);
assert.match(completed, /value="100"/);

console.log('Terminal and paused task progress renders static states without perpetual loading animation.');
