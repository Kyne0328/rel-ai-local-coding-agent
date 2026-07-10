import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(root, relative));

const dashboardCss = read('public/dashboard.css');
const shellCss = read('src/ui/dashboard-shell.css');
const interactionsCss = read('src/ui/dashboard-interactions.css');
const preferencesCss = read('src/ui/dashboard-preferences.css');
const preferencesJs = read('src/ui/preferences.js');
const dashboardServer = read('src/http/dashboard.js');
const dashboardJs = read('public/dashboard.js');

assert.match(dashboardCss, /dashboard-shell\.css/);
assert.match(dashboardCss, /dashboard-interactions\.css/);
assert.match(dashboardCss, /dashboard-preferences\.css/);
assert.doesNotMatch(dashboardCss, /phase\d?\.css/i);
assert.equal(exists('src/ui/phase1.css'), false);
assert.equal(exists('src/ui/phase2.css'), false);
assert.equal(exists('test/ui-phase1-smoke.mjs'), false);
assert.equal(exists('test/ui-phase2-smoke.mjs'), false);
assert.match(shellCss, /@layer dashboard-shell/);
assert.match(interactionsCss, /@layer dashboard-interactions/);

assert.match(dashboardServer, /DASHBOARD_NAV_ITEMS/);
assert.match(dashboardServer, /renderDashboardNav/);
assert.match(dashboardServer, /id="commandPaletteBtn"/);
assert.match(dashboardServer, /id="workspaceQuickNav"/);
assert.match(dashboardServer, /relai_ui_theme/);
assert.match(dashboardJs, /openCommandPalette/);
assert.match(dashboardJs, /populateWorkspaceQuickNav/);
assert.match(dashboardJs, /focusWorkspaceCard/);
assert.match(dashboardJs, /initUiPreferences/);
assert.match(interactionsCss, /max-width: 1250px/);
assert.match(interactionsCss, /grid-template-columns: repeat\(5/);
assert.match(interactionsCss, /\.nav-icon/);

assert.match(preferencesJs, /setThemePreference/);
assert.match(preferencesJs, /setDensityPreference/);
assert.match(preferencesJs, /prefers-color-scheme: light/);
assert.match(preferencesCss, /data-theme="light"/);
assert.match(preferencesCss, /data-density="compact"/);
assert.match(preferencesCss, /prefers-reduced-motion/);

const actionState = read('src/ui/action-state.js');
const workspaceActions = read('src/ui/sections/workspace-actions.js');
const workspaceForm = read('src/ui/sections/workspace-form.js');
const settingsShared = read('src/ui/sections/settings/shared.js');
const settingsGeneral = read('src/ui/sections/settings/general.js');
assert.match(actionState, /runButtonAction/);
assert.match(workspaceActions, /runButtonAction/);
assert.match(workspaceForm, /runButtonAction/);
assert.match(settingsShared, /runButtonAction/);
assert.match(settingsGeneral, /Appearance/);
assert.match(settingsGeneral, /Interface density/);
assert.doesNotMatch(workspaceForm, /<style>|style="|style\.cssText/);
assert.doesNotMatch(settingsShared, /style\.cssText|style="/);

const activity = read('src/ui/sections/activity.js');
assert.match(activity, /activityWorkspaceFilter/);
assert.match(activity, /activityToolFilter/);
assert.match(activity, /activityStatusFilter/);
assert.match(activity, /Clear filters/);
assert.match(activity, /Copy event JSON/);
assert.match(activity, /row\.onkeydown/);

console.log('Dashboard UI smoke test passed.');
