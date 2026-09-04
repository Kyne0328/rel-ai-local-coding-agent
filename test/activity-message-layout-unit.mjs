import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/features/activity/styles.css', 'utf8');
const columns = ['time', 'tool', 'task', 'status', 'message', 'action'];

assert.doesNotMatch(css, /\.activity-col-message\s*\{[^}]*width:\s*calc\(/s, 'Message width must not depend on brittle calc chains');
for (const column of columns) {
  assert.match(css, new RegExp(`\\.activity-col-${column}\\s*\\{[^}]*width:\\s*\\d+(?:\\.\\d+)?%`, 's'), `${column} must participate in the shared percentage column model`);
}
assert.match(css, /@media\s*\(max-width:[^)]+\)[\s\S]*\.activity-task-column[\s\S]*display:\s*none/s, 'narrow layouts may fold the task column into the message cell');
assert.match(css, /\.activity-message-mobile-task\s*\{[^}]*display:\s*none/s, 'desktop rows must not duplicate the task label');
assert.match(css, /@media\s*\(max-width:[^)]+\)[\s\S]*\.activity-message-mobile-task[\s\S]*block/s, 'narrow layouts must keep task attribution visible in the message cell');
assert.match(css, /@media\s*\(max-width:[^)]+\)[\s\S]*\.activity-time-column[\s\S]*display:\s*none/s, 'the narrowest responsive layout must yield lower-priority columns before squeezing message content');
assert.match(css, /\.activity-message-copy\s*\{[^}]*min-width:/s, 'message text must retain an explicit readable minimum width');

console.log('Activity message layout invariants passed.');
