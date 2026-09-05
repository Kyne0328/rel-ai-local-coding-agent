import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const appCss = read('src/ui/styles/app.css');
const compiledCss = read('public/dashboard.css');

assert.match(appCss, /@import "tailwindcss"/);
for (const imported of [
  '../components/filter-controls.css',
  '../features/home/styles.css',
  '../features/onboarding/styles.css',
  '../features/settings/styles.css',
  '../features/system/styles.css',
  '../features/sessions/styles.css',
  '../features/activity/styles.css',
  '../features/workspaces/styles.css',
  '../features/tools/styles.css',
  '../features/processes/styles.css'
]) assert.match(appCss, new RegExp(imported.replaceAll('/', '\\/').replace('.', '\\.')));
for (const selector of ['.overview-hero-compact', '.desktop-setup-item', '.settings-content', '.connection-primary-action', '.activity-table', '.filter-drawer-footer']) {
  assert.match(compiledCss, new RegExp(selector.replace('.', '\\.')));
}
assert.doesNotMatch(appCss, /\.settings-shell|\.connection-primary-action|\.activity-table/);

console.log('Visual hierarchy ownership contracts passed.');
