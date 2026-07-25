import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const css = read('src/ui/styles/app.css');
const home = read('src/ui/features/home/index.js');
const activity = read('src/ui/features/activity/index.js');
const workspaces = read('src/ui/features/workspaces/cards.js');
const sessions = read('src/ui/features/sessions/index.js');
const connector = read('src/ui/features/settings/connector.js');
const settingsIndex = read('src/ui/features/settings/index.js');
const wizardHtml = read('electron/renderer/wizard.html');
const electronCss = read('electron/renderer/app.css');

assert.match(css, /@import "tailwindcss"/);
assert.match(css, /\.app-shell[\s\S]*grid-template-columns: var\(--sidebar-width\) minmax\(0, 1fr\)/);
assert.match(css, /--sidebar-width: 252px/);
assert.match(css, /\.page-title \{ @apply truncate text-\[23px\]/);
assert.match(css, /\.sidebar[\s\S]*box-shadow:/);
assert.match(css, /\.topbar[\s\S]*box-shadow:/);
assert.match(css, /\.card, \.metric, \.workspace-card, \.tool-card[\s\S]*box-shadow: none/);
assert.doesNotMatch(css, /\.metric:hover[^}]*translateY/s);
assert.doesNotMatch(css, /\.workspace-card:hover[^}]*translateY/s);

assert.match(css, /\.summary-metrics/);
assert.match(css, /\.summary-metrics \.metric[\s\S]*border-r/);
assert.match(workspaces, /overview-grid overview-grid-compact summary-metrics/);
assert.match(sessions, /overview-grid overview-grid-compact summary-metrics/);

assert.match(workspaces, /class="workspace-readiness \$\{view\.available \? 'good' : 'bad'\}"/);
assert.match(workspaces, /class="workspace-access-summary"/);
assert.match(workspaces, /<dl class="workspace-readiness-facts">/);
assert.match(workspaces, /Ready for ChatGPT/);
assert.doesNotMatch(workspaces, /workspace-readiness-item|workspace-readiness-primary/);
assert.match(css, /\.workspace-readiness/);
assert.match(css, /\.workspace-access-summary/);
assert.match(css, /grid-template-columns: minmax\(0,1\.15fr\) minmax\(0,\.85fr\)/);
assert.match(css, /\.workspace-operational, \.workspace-policy-grid/);
assert.match(workspaces, /class="primary" type="button" data-add-workspace/);
assert.match(css, /button\[data-add-workspace\][\s\S]*border-color:/);

assert.match(connector, /connection-layer-state/);
assert.match(connector, /className = 'connection-path'/);
assert.match(connector, /className = `connection-path-step \$\{layer\.tone\}`/);
assert.match(connector, /className = 'connection-actions-bar'/);
assert.doesNotMatch(connector, /connection-layer-grid|connection-actions-card/);
assert.match(connector, /state\.chatgptReadiness\?\.status === 'ready'/);
assert.match(connector, /connection-setup-details/);
assert.match(css, /\.connection-layer-state\.ok/);
assert.match(css, /\.connection-path/);
assert.match(css, /grid-template-columns: repeat\(4,minmax\(0,1fr\)\)/);
assert.match(css, /\.connection-actions-bar/);

assert.match(settingsIndex, /shell\.className = 'settings-layout settings-shell'/);
assert.match(settingsIndex, /content\.className = 'settings-content'/);
assert.match(css, /\.settings-nav-button\.active/);
assert.match(css, /\.settings-panel-intro[\s\S]*border-left-color: var\(--blue\)/);
assert.match(css, /\.tool-card[\s\S]*box-shadow: none/);
assert.doesNotMatch(css, /\.tool-card:hover[^}]*box-shadow:/s);

assert.doesNotMatch(home, /<h2>Overview<\/h2>/);
assert.match(css, /font-size: 28px/);
assert.doesNotMatch(activity, /<h2>Activity<\/h2>/);
assert.match(activity, /class="data-table activity-table"/);
assert.match(activity, /<colgroup>/);
assert.match(css, /\.activity-table \{ min-width: 100%; \}/);
assert.match(css, /\.data-table td[\s\S]*h-\[54px\]/);
assert.doesNotMatch(sessions, /<h2>Sessions<\/h2>/);
assert.match(css, /\.session-row, \.task-row[\s\S]*min-h-\[76px\]/);
assert.doesNotMatch(sessions, /Not published/);
assert.match(sessions, /publish \? `<span class="task-row-publish">/);
assert.match(css, /\.status-pill\.ok::before/);
assert.doesNotMatch(css, /\.status-pill\.ok::before[^}]*animation/s);

assert.match(css, /\.diagnostic-metrics[\s\S]*grid-template-columns: repeat\(3,minmax\(0,1fr\)\)/);
assert.match(css, /\.diagnostic-finding[\s\S]*border-l-\[3px\]/);
assert.match(css, /\.diagnostic-log-row\.error[\s\S]*inset 2px 0 var\(--red\)/);
assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.summary-metrics \.metric/);

assert.match(wizardHtml, /class="setup-principles"/);
assert.match(wizardHtml, /Local by default/);
assert.match(wizardHtml, /Scoped access/);
assert.doesNotMatch(wizardHtml, /setup-check|setup-benefits/);
assert.match(electronCss, /\.setup-principles[^}]*grid-template-columns: repeat\(3/s);
assert.match(electronCss, /\.setup-principle \{/);
assert.match(electronCss, /\.app-card \{[^}]*box-shadow: none;/s);
assert.match(electronCss, /\.setup-card,\s*\.status-hero \{ box-shadow: var\(--elev-2\); \}/s);
assert.doesNotMatch(electronCss, /\.status-badge\.ready::before[^}]*box-shadow/s);

console.log('Visual hierarchy smoke test passed.');
