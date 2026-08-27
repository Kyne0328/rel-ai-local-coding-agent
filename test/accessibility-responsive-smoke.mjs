import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOBILE_NAV_ITEMS } from '../src/ui/navigation-catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const filterCss = read('src/ui/components/filter-controls.css');
const appCss = read('src/ui/styles/app.css');

const mobileNavIds = MOBILE_NAV_ITEMS.map(item => item.id);
assert.ok(mobileNavIds.length > 0, 'mobile navigation must not be empty');
assert.equal(new Set(mobileNavIds).size, mobileNavIds.length, 'mobile navigation destinations must be unique');
for (const required of ['home', 'tasks', 'workspaces', 'activity', 'system', 'settings']) {
  assert.ok(mobileNavIds.includes(required), `${required} must remain reachable from mobile navigation`);
}
assert.equal(MOBILE_NAV_ITEMS.find(item => item.id === 'system')?.href, '#connection');
assert.ok((filterCss.match(/@media \(max-width:/g) || []).length >= 1, 'filter controls must have a narrow-screen layout');
assert.match(filterCss, /safe-area-inset-bottom/);
assert.match(appCss, /@import "\.\.\/components\/filter-controls\.css"/);
assert.match(appCss, /\.nav a:focus-visible \.nav-label, \.secondary-nav a:focus-visible \.nav-label/);
assert.match(appCss, /:root:not\(\[data-sidebar="collapsed"\]\) \.sidebar \{/, 'expanded sidebar must retain a narrow-layout override');
assert.match(appCss, /:root:not\(\[data-sidebar="collapsed"\]\) \.brand-identity \{[^}]*flex:/s, 'expanded sidebar identity must remain flexible on narrow layouts');
for (const feature of ['sessions', 'activity', 'workspaces', 'tools', 'processes']) {
  assert.match(appCss, new RegExp(`@import "\\.\\.\\/features\\/${feature}\\/styles\\.css"`));
}



const activitySource = read('src/ui/features/activity/index.js');
const activityCss = read('src/ui/features/activity/styles.css');
const sessionsCss = read('src/ui/features/sessions/styles.css');
const processesCss = read('src/ui/features/processes/styles.css');
const workspaceForm = read('src/ui/features/workspaces/form.js');
assert.match(activityCss, /\.activity-col-tool\s*\{[^}]*width:/s, 'Activity must preserve the dedicated Tool column');
assert.match(activityCss, /\.activity-col-workspace\s*\{[^}]*width:/s, 'Activity must preserve the dedicated Workspace column');
assert.match(activityCss, /\.activity-col-action\s*\{[^}]*width:/s, 'Activity must preserve the row action column');
assert.match(activityCss, /@media \(max-width: 760px\)[\s\S]*activity-message-mobile-meta[\s\S]*display:/, 'narrow Activity layouts must preserve status and time inside the message cell');
assert.doesNotMatch(activitySource, /activity-session-column">Session/, 'Activity must not replace the original table columns with a Session column');
assert.doesNotMatch(activitySource, /row\.tabIndex\s*=\s*0/, 'Activity rows must not duplicate the action button as a keyboard focus target');
assert.doesNotMatch(activitySource, /row\.onkeydown/, 'Activity keyboard activation must use the native row action button');
assert.match(activitySource, /activity-row-button/, 'Activity rows must retain a native focusable action control');
assert.match(sessionsCss, /\.task-row-facts\s*\{/, 'Session exception facts must have a quiet secondary style');
assert.match(sessionsCss, /\.task-detail-technical\s*\{/, 'technical session metadata must be visually secondary and collapsible');
const workspaceCss = read('src/ui/features/workspaces/styles.css');
const systemCss = read('src/ui/features/system/styles.css');
assert.match(activityCss, /\.activity-message-column\s*\{[^}]*min-width:\s*0/s);
assert.match(activityCss, /\.activity-message-copy\s*\{[^}]*width:\s*100%/s); // rigidity-ok: message copy must fill its table cell to preserve truncation behavior
assert.match(workspaceCss, /\.workspace-operational > \*\s*\{[^}]*min-width:\s*0/s);
assert.match(workspaceCss, /\.workspace-readiness\s*\{[^}]*min-w-0/s);
assert.match(systemCss, /\.diagnostic-log-row\s*\{[^}]*min-width:\s*0/s);
assert.match(systemCss, /\.diagnostic-log-row code\s*\{[^}]*max-width:/s);
assert.match(appCss, /:root\[data-window-chrome="custom"\] \.toast-region\s*\{[^}]*top:/s, 'custom window chrome must offset notifications below the titlebar');
assert.match(appCss, /:root\[data-window-chrome="custom"\] \.main\s*\{[^}]*padding-top:\s*0/s, 'custom window chrome must not leave a second top offset above sticky section headers');
assert.match(appCss, new RegExp(`\\.mobile-nav\\s*\\{[^}]*grid-template-columns:\\s*repeat\\(${MOBILE_NAV_ITEMS.length},`, 's'), 'mobile navigation must allocate one column per destination');
assert.doesNotMatch(appCss, /@media \(max-width: 420px\)[\s\S]{0,500}grid-template-columns:\s*repeat\(3/, 'small mobile layouts must not restore the two-row navigation');
assert.match(filterCss, /\.filter-chip\s*\{[^}]*min-height:\s*44px/s, 'filter chips must meet the touch-target baseline');
assert.match(activityCss, /\.activity-row-button\s*\{[^}]*min-h-11/s, 'Activity row actions must retain a touch-friendly minimum height');
assert.match(processesCss, /\.process-output summary\s*\{[^}]*min-height:\s*44px/s, 'process output disclosures must meet the touch-target baseline');
assert.match(systemCss, /\.diagnostic-copy summary\s*\{[^}]*min-h-11/s, 'diagnostic detail disclosures must meet the touch-target baseline');
assert.match(workspaceForm, /pathValidationGeneration/, 'workspace preflight validation must reject stale async results');
assert.match(workspaceForm, /generation !== pathValidationGeneration/, 'workspace preflight results must be generation guarded');
for (const name of ['path', 'alias']) {
  assert.match(workspaceForm, new RegExp(`name="${name}"[^>]*type="text"|type="text"[^>]*name="${name}"`), `workspace ${name} input must declare type=text explicitly`);
}
const toastSource = read('src/ui/components/toast.js');
assert.match(toastSource, /error:\s*\{[^}]*duration:\s*0/s, 'error notifications must remain visible until dismissed by default');
assert.match(toastSource, /toast-dismiss/, 'notifications must expose a manual dismiss control');

console.log('Accessibility and responsive ownership contracts passed.');
