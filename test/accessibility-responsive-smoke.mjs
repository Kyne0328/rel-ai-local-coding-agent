import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOBILE_MORE_NAV_ITEMS, MOBILE_NAV_ITEMS, MOBILE_PRIMARY_NAV_ITEMS } from '../src/ui/navigation-catalog.js';

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
assert.equal(MOBILE_NAV_ITEMS.find(item => item.id === 'system')?.href, '#processes');
assert.deepEqual(MOBILE_PRIMARY_NAV_ITEMS.map(item => item.id), ['home', 'tasks', 'workspaces', 'activity'], 'mobile navigation should keep only the four highest-frequency destinations visible');
assert.deepEqual(MOBILE_MORE_NAV_ITEMS.map(item => item.id), ['code', 'system', 'settings'], 'lower-frequency mobile destinations should remain reachable through More');
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
const sessionsSource = read('src/ui/features/sessions/index.js');
const usageSource = read('src/ui/features/usage/render.js');
const usageCss = read('src/ui/features/usage/styles.css');
const codeSource = read('src/ui/features/code/index.js');
assert.match(activityCss, /\.activity-col-time\s*\{[^}]*width:/s, 'Activity must preserve a compact Time column');
assert.match(activityCss, /\.activity-col-message\s*\{/, 'Activity must give the remaining width to one consolidated Activity column');
assert.doesNotMatch(activitySource, /activity-action-column|activity-row-button/, 'Activity must not keep a redundant Open action column');
assert.match(activitySource, /activity-row-trigger/, 'Activity rows must retain one native focusable trigger inside the consolidated activity cell');
assert.match(activitySource, /activity-row-meta/, 'Activity rows must keep status, action, task, and project as supporting metadata');
assert.doesNotMatch(activitySource, /row\.tabIndex\s*=\s*0/, 'Activity rows must not duplicate the native trigger as a keyboard focus target');
assert.doesNotMatch(activitySource, /row\.onkeydown/, 'Activity keyboard activation must use the native activity trigger');
assert.match(sessionsSource, /role="tablist"[\s\S]*aria-controls="session-panel-overview"[\s\S]*tabindex="-1"/, 'Task inspector tabs must expose tab relationships and one roving tab stop');
assert.match(sessionsSource, /ArrowLeft[\s\S]*ArrowRight[\s\S]*Home[\s\S]*End/, 'Task inspector tabs must support standard keyboard navigation');
assert.match(sessionsSource, /role="tabpanel"[\s\S]*aria-labelledby="session-tab-overview"[\s\S]*tabindex="0"/, 'Task inspector panels must expose tabpanel relationships and a keyboard destination');
assert.match(sessionsSource, /revealStackedSessionInspector/, 'stacked task details must explicitly reveal and focus the selected inspector');
assert.match(activitySource, /revealStackedActivityInspector/, 'stacked Activity details must explicitly reveal and focus the selected inspector');
assert.match(usageSource, /help\.addEventListener\('pointerenter'/, 'Analytics help must keep the combined trigger and tooltip hoverable');
assert.match(usageSource, /help\.addEventListener\('focusin'/, 'Analytics help must remain available while focus is inside the help region');
assert.doesNotMatch(usageCss, /usage-metric-tooltip[^}]*pointer-events:\s*none/s, 'Analytics tooltip content must remain hoverable');
assert.doesNotMatch(codeSource, /getModifiedEditor\(\)\.focus\(/, 'Changes must not steal focus into Monaco during automatic diff rendering');
assert.match(workspaceForm, /aria-label="Change source folder \$\{esc\(value\)\}"/, 'Repeated source-folder change controls need contextual accessible names');
assert.match(workspaceForm, /aria-label="Remove source folder \$\{esc\(value\)\}"/, 'Repeated source-folder remove controls need contextual accessible names');
assert.doesNotMatch(sessionsSource, /task-row-facts|sessionFacts\(/, 'Task rows must keep secondary counters and publish facts in the inspector instead of the list');
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
assert.match(appCss, /\.mobile-nav-more-menu\s*\{/, 'mobile More navigation must expose an explicit overflow menu');
assert.doesNotMatch(appCss, /\.mobile-nav\s*\{[^}]*overflow-x-auto/s, 'mobile navigation must not hide destinations behind horizontal scrolling');
assert.match(filterCss, /\.filter-chip\s*\{[^}]*min-height:\s*44px/s, 'filter chips must meet the touch-target baseline');
assert.match(activityCss, /\.activity-row-trigger\s*\{[^}]*min-h-11/s, 'Activity row triggers must retain a touch-friendly minimum height');
assert.match(processesCss, /\.process-output summary\s*\{[^}]*min-height:\s*44px/s, 'process output disclosures must meet the touch-target baseline');
assert.match(systemCss, /\.diagnostic-copy summary\s*\{[^}]*min-h-11/s, 'diagnostic detail disclosures must meet the touch-target baseline');
assert.match(workspaceForm, /pathValidationGeneration/, 'workspace preflight validation must reject stale async results');
assert.match(workspaceForm, /generation !== pathValidationGeneration/, 'workspace preflight results must be generation guarded');
assert.match(workspaceForm, /name="alias"[^>]*type="text"|type="text"[^>]*name="alias"/, 'workspace alias input must declare type=text explicitly');
assert.match(workspaceForm, /<textarea[^>]*name="paths"/, 'workspace source paths must use the current multi-source textarea');
const toastSource = read('src/ui/components/toast.js');
assert.match(toastSource, /error:\s*\{[^}]*duration:\s*0/s, 'error notifications must remain visible until dismissed by default');
assert.match(toastSource, /toast-dismiss/, 'notifications must expose a manual dismiss control');

console.log('Accessibility and responsive ownership contracts passed.');
