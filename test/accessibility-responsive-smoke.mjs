import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOBILE_NAV_ITEMS } from '../src/ui/navigation-catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const filterCss = read('src/ui/components/filter-controls.css');
const appCss = read('src/ui/styles/app.css');

assert.deepEqual(MOBILE_NAV_ITEMS.map(item => item.id), ['home', 'tasks', 'workspaces', 'system', 'settings']);
assert.equal(MOBILE_NAV_ITEMS.find(item => item.id === 'system')?.href, '#connection');
assert.match(filterCss, /@media \(max-width: 760px\)/);
assert.match(filterCss, /@media \(max-width: 520px\)/);
assert.match(filterCss, /safe-area-inset-bottom/);
assert.match(filterCss, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(appCss, /@import "\.\.\/components\/filter-controls\.css"/);
assert.match(appCss, /\.nav a:focus-visible \.nav-label, \.secondary-nav a:focus-visible \.nav-label/);
for (const feature of ['sessions', 'activity', 'workspaces', 'tools', 'processes']) {
  assert.match(appCss, new RegExp(`@import "\\.\\.\\/features\\/${feature}\\/styles\\.css"`));
}



const activitySource = read('src/ui/features/activity/index.js');
const activityCss = read('src/ui/features/activity/styles.css');
const sessionsCss = read('src/ui/features/sessions/styles.css');
assert.match(activityCss, /\.activity-col-tool\s*\{[^}]*width:/s, 'Activity must preserve the dedicated Tool column');
assert.match(activityCss, /\.activity-col-workspace\s*\{[^}]*width:/s, 'Activity must preserve the dedicated Workspace column');
assert.match(activityCss, /\.activity-col-action\s*\{[^}]*width:/s, 'Activity must preserve the row action column');
assert.match(activityCss, /@media \(max-width: 760px\)[\s\S]*activity-message-mobile-meta[\s\S]*display:/, 'narrow Activity layouts must preserve status and time inside the message cell');
assert.doesNotMatch(activitySource, /activity-session-column">Session/, 'Activity must not replace the original table columns with a Session column');
assert.match(activitySource, /if \(event\.target !== row\) return;/, 'nested Activity controls must not bubble keyboard activation into the event-row dialog action');
assert.match(sessionsCss, /grid-template-columns:\s*auto minmax\(0,1fr\) auto 18px/, 'Session rows must use the simplified four-column layout');
assert.match(sessionsCss, /\.task-row-facts\s*\{/, 'Session exception facts must have a quiet secondary style');
assert.match(sessionsCss, /\.task-detail-technical\s*\{/, 'technical session metadata must be visually secondary and collapsible');
const workspaceCss = read('src/ui/features/workspaces/styles.css');
const systemCss = read('src/ui/features/system/styles.css');
assert.match(activityCss, /\.activity-message-column\s*\{[^}]*min-width:\s*0/s);
assert.match(activityCss, /\.activity-message-copy\s*\{[^}]*width:\s*100%/s);
assert.match(workspaceCss, /\.workspace-operational > \*, \.workspace-policy-grid > \*\s*\{[^}]*min-width:\s*0/s);
assert.match(workspaceCss, /\.workspace-validation-head\s*\{/);
assert.match(systemCss, /\.diagnostic-log-row\s*\{[^}]*min-width:\s*0/s);
assert.match(systemCss, /\.diagnostic-log-row code\s*\{[^}]*max-width:/s);
assert.match(appCss, /:root\[data-window-chrome="custom"\] \.toast-region\s*\{[^}]*top:\s*calc\(var\(--window-titlebar-height\) \+ 96px\)/s);

console.log('Accessibility and responsive ownership contracts passed.');
