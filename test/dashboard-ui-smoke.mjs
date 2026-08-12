import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESKTOP_NAV_ITEMS, MOBILE_NAV_ITEMS, SETTINGS_NAV_ITEMS } from '../src/ui/navigation-catalog.js';
import { activityFilterTransition, mergeActivityEntries } from '../src/ui/features/activity/model.js';
import { normalizeRouteKey } from '../src/ui/route-policy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const shell = read('src/http/dashboard.js');
const dashboard = read('public/dashboard.js');
const router = read('src/ui/router.js');
const settings = read('src/ui/features/settings/index.js');

assert.deepEqual(DESKTOP_NAV_ITEMS.map(item => item.id), ['home', 'tasks', 'workspaces', 'activity', 'system', 'settings']);
assert.deepEqual(MOBILE_NAV_ITEMS.map(item => item.id), ['home', 'tasks', 'workspaces', 'system', 'settings']);
assert.equal(DESKTOP_NAV_ITEMS.find(item => item.id === 'activity')?.label, 'Tool Activity');
assert.equal(DESKTOP_NAV_ITEMS.find(item => item.id === 'system')?.href, '#connection');
assert.equal(normalizeRouteKey('system'), 'connection');
assert.deepEqual(SETTINGS_NAV_ITEMS.map(item => item.id), ['preferences', 'skills', 'application', 'advanced', 'about']);
assert.match(shell, /WORK_NAV_ITEMS, APPLICATION_NAV_ITEMS, MOBILE_NAV_ITEMS/);
assert.match(shell, /aria-label="\$\{item\.label\}" title="\$\{item\.label\}"/);
assert.doesNotMatch(shell, /const PRIMARY_NAV_ITEMS|const SECONDARY_NAV_ITEMS/);
assert.match(router, /routeMetadata\(path\)/);
assert.match(router, /document\.getElementById\('pageTitle'\)\?\.focus\(\{ preventScroll: true \}\)/);
assert.match(dashboard, /features\/system\/index\.js/);
assert.match(dashboard, /mountSettings\(element, settingsSubPage\(\)\)/);
assert.doesNotMatch(dashboard, /settings\/connection|settings\/diagnostics/);
assert.match(settings, /mountApplication/);
assert.match(settings, /mountSkills/);
assert.match(read('src/ui/features/system/index.js'), /SYSTEM_NAV_ITEMS/);
assert.equal(fs.existsSync(path.join(root, 'src/ui/features/settings/tools-validation.js')), false);
assert.equal(typeof mergeActivityEntries, 'function');
assert.equal(typeof activityFilterTransition, 'function');

console.log('Dashboard UI ownership contracts passed.');

