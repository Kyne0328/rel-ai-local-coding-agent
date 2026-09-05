import assert from 'node:assert/strict';

import { taskProgressHtml } from '../src/ui/components/task-progress.js';

const indeterminate = { mode: 'indeterminate', label: 'Running command' };

for (const [status, className, state, fallback] of [
  ['failed', 'static terminal failed', 'Failed', 'Work session failed'],
  ['cancelled', 'static terminal cancelled', 'Cancelled', 'Work session cancelled'],
  ['inactive', 'static terminal cancelled', 'Expired', 'Work session expired'],
  ['expired', 'static terminal cancelled', 'Expired', 'Work session expired']
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
  ['waiting_for_approval', 'static paused blocked', 'Action required']
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

const completedWithoutProgress = taskProgressHtml({}, 'completed');
assert.match(completedWithoutProgress, /task-progress complete/);
assert.match(completedWithoutProgress, /role="status"/);
assert.match(completedWithoutProgress, /Work session completed/);
assert.doesNotMatch(completedWithoutProgress, /indeterminate/);

console.log('Terminal and paused task progress renders static states without perpetual loading animation.');
