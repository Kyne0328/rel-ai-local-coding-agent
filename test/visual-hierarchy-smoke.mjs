import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const componentsCss = read('src/ui/components.css');
const shellCss = read('src/ui/dashboard-shell.css');
const interactionsCss = read('src/ui/dashboard-interactions.css');
const dashboardCss = read('public/dashboard.css');
const workspaces = read('src/ui/sections/workspace-cards.js');
const sessions = read('src/ui/sections/tasks.js');
const connector = read('src/ui/sections/settings/connector.js');
const settingsIndex = read('src/ui/sections/settings/index.js');
const electronCss = read('electron/renderer/app.css');

assert.match(dashboardCss, /\.sidebar,\s*\.topbar\s*\{\s*box-shadow: var\(--elev-1\);/s);
assert.match(dashboardCss, /\.card,\s*\.metric \{ box-shadow: none; \}/s);
assert.match(componentsCss, /\.card \{[^}]*box-shadow: none;/s);
assert.match(componentsCss, /\.metric \{[^}]*box-shadow: none;/s);
assert.doesNotMatch(componentsCss, /\.metric:hover[^}]*translateY/s);
assert.doesNotMatch(componentsCss, /\.workspace-card:hover[^}]*translateY/s);

assert.match(dashboardCss, /\.summary-metrics \{/);
assert.match(dashboardCss, /\.summary-metrics \.metric \{[^}]*border-right: 1px solid var\(--line-soft\);/s);
assert.match(dashboardCss, /\.summary-metrics \.metric:last-child \{ border-right: 0; \}/);
assert.match(workspaces, /overview-grid overview-grid-compact summary-metrics/);
assert.match(sessions, /overview-grid overview-grid-compact summary-metrics/);

assert.match(dashboardCss, /\.workspace-readiness \{[^}]*gap: 0;[^}]*overflow: hidden;/s);
assert.match(dashboardCss, /\.workspace-readiness-item\.good \{ box-shadow: inset 0 2px var\(--green\); \}/);
assert.match(dashboardCss, /\.workspace-operational \{[^}]*gap: 0;/s);
assert.match(dashboardCss, /\.workspace-policy-grid \{[^}]*gap: 0;/s);
assert.match(workspaces, /class="primary" type="button" data-add-workspace/);

assert.match(connector, /connection-layer-state/);
assert.doesNotMatch(connector, /<span class="status-pill \$\{layer\.tone\}">/);
assert.match(connector, /state\.chatgptReadiness\?\.status === 'ready'/);
assert.match(connector, /connection-setup-details/);
assert.match(connector, /The app is ready; reopen these steps only when reconnecting/);
assert.match(shellCss, /\.connection-layer-state\.ok \{ color: var\(--green\); \}/);
assert.match(shellCss, /\.connection-layer-card[^}]*box-shadow: none;/s);

assert.match(settingsIndex, /content\.className = 'settings-content'/);
assert.match(shellCss, /\.settings-nav-button\.active[^}]*background: var\(--accent-dim\);/s);
assert.match(interactionsCss, /\.settings-panel-intro[^}]*border-left: 2px solid/s);
assert.match(interactionsCss, /\.tool-card[^}]*box-shadow: none;/s);
assert.doesNotMatch(interactionsCss, /\.tool-card:hover[^}]*box-shadow: var\(--elev-2\)/s);

assert.doesNotMatch(sessions, /Not published/);
assert.match(sessions, /publish \? `<span class="task-row-publish">/);
assert.match(componentsCss, /\.status-pill\.ok::before\s*\{ background: var\(--green\); \}/);
assert.doesNotMatch(componentsCss, /\.status-pill\.ok::before[^}]*animation/s);
assert.doesNotMatch(componentsCss, /\.status-pill\.ok::before[^}]*box-shadow/s);

assert.match(dashboardCss, /\.diagnostic-metrics \{[^}]*gap: 0;/s);
assert.match(dashboardCss, /\.diagnostic-finding[^}]*border-left-width: 3px;/s);
assert.match(dashboardCss, /\.diagnostic-log-row\.error \{ box-shadow: inset 2px 0 var\(--red\); \}/);
assert.match(dashboardCss, /@media \(max-width: 860px\)[\s\S]*\.summary-metrics \.metric,[\s\S]*border-bottom: 1px solid var\(--line-soft\);/);

assert.match(electronCss, /\.app-card \{[^}]*box-shadow: none;/s);
assert.match(electronCss, /\.setup-card,\s*\.status-hero \{ box-shadow: var\(--elev-2\); \}/s);
assert.match(electronCss, /\.status-health-grid[^}]*gap: 0;[^}]*overflow: hidden;/s);
assert.match(electronCss, /\.status-health-card[^}]*border-right: 1px solid var\(--line-soft\);/s);
assert.match(electronCss, /@media \(max-width: 520px\)[\s\S]*\.status-health-card \{ border-right: 0; border-bottom: 1px solid var\(--line-soft\); \}/);
assert.doesNotMatch(electronCss, /\.status-badge\.ready::before[^}]*box-shadow/s);

console.log('Visual hierarchy smoke test passed.');
