import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const css = read('src/ui/styles/app.css');
const settings = read('src/ui/features/settings/index.js');
const toggle = read('src/ui/components/toggle.js');
const emptyState = read('src/ui/components/empty-state.js');
const sessions = read('src/ui/features/sessions/index.js');
const tools = read('src/ui/features/tools/index.js');
const diagnostics = read('src/ui/features/settings/diagnostics.js');
const toast = read('src/ui/components/toast.js');
const drawer = read('src/ui/components/drawer.js');
const workspaceMenu = read('src/ui/components/workspace-menu.js');
const workspaces = read('src/ui/features/workspaces/cards.js');
const dashboardServer = read('src/http/dashboard.js');
const dashboardClient = read('public/dashboard.js');
const advancedSettings = read('src/ui/features/settings/advanced.js');
const vscodeSettings = JSON.parse(read('.vscode/settings.json'));
const vscodeExtensions = JSON.parse(read('.vscode/extensions.json'));

assert.match(css, /@import "tailwindcss"/);
assert.equal(vscodeSettings['files.associations']?.['src/ui/styles/app.css'], 'tailwindcss');
assert.equal(vscodeSettings['css.lint.unknownAtRules'], 'ignore');
assert.ok(vscodeExtensions.recommendations?.includes('bradlc.vscode-tailwindcss'));
assert.doesNotMatch(css, /@source\b/);
assert.match(settings, /shell\.className = 'settings-layout settings-shell'/);
for (const className of [
  'settings-shell',
  'settings-header',
  'settings-panel-body',
  'settings-form-grid',
  'settings-field',
  'settings-help',
  'appearance-preview',
  'settings-fact-grid',
  'settings-validation-row'
]) {
  assert.match(css, new RegExp(`\\.${className}\\b`), `missing Tailwind contract for ${className}`);
}

assert.match(toggle, /wrap\.className = 'toggle-control'/);
assert.match(toggle, /input\.className = 'toggle-input'/);
assert.match(toggle, /span\.className = 'toggle-label'/);
assert.doesNotMatch(toggle, /style\.cssText|style="/);
assert.match(css, /input\[type="checkbox"\]:not\(\.toggle-input\)/);
assert.match(css, /\.toggle-input:checked::after/);

assert.match(sessions, /class="task-row"/);
assert.match(css, /\.session-row, \.task-row[\s\S]*w-full[\s\S]*grid-template-columns: auto minmax\(0,1fr\) minmax\(0,auto\) auto 18px/);
for (const className of [
  'task-row-status',
  'task-row-main',
  'task-row-time',
  'session-list-footer',
  'task-detail-grid',
  'task-file-list',
  'task-event-list',
  'task-detail-overflow',
  'session-detail-actions'
]) {
  assert.match(css, new RegExp(`\\.${className}\\b`));
}
assert.match(sessions, /SESSION_PAGE_SIZE = 50/);
assert.match(sessions, /data-load-more-sessions/);
assert.match(sessions, /panelClass: 'session-detail-drawer'/);
assert.match(sessions, /DETAIL_FILE_PREVIEW = 12/);
assert.match(sessions, /DETAIL_EVENT_PREVIEW = 20/);
assert.match(sessions, /workspaceMenuHtml\(data\.config\?\.workspaces/);
assert.match(workspaces, /workspaceMenuHtml\(allWorkspaces, workspaceFilter/);
assert.match(workspaceMenu, /aria-haspopup="listbox"/);
assert.match(workspaceMenu, /role="listbox"/);
assert.match(workspaceMenu, /role="option"/);
for (const className of ['workspace-menu', 'workspace-menu-trigger', 'workspace-menu-popover', 'workspace-menu-option']) {
  assert.match(css, new RegExp(`\\.${className}\\b`));
}
assert.doesNotMatch(dashboardServer, /workspaceScope|refreshBtn|topbar-refresh/);
assert.doesNotMatch(dashboardClient, /configureLiveRefresh|dashboardRefreshSeconds|liveLogPollSeconds/);
assert.doesNotMatch(advancedSettings, /Fallback refresh interval|Live event scan interval|Dashboard updates/);

assert.match(css, /\.workspace-grid[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
assert.match(css, /@media \(max-width: 1700px\)[\s\S]*\.workspace-grid[\s\S]*repeat\(2,minmax\(0,1fr\)\)/);
assert.match(css, /\.workspace-readiness[\s\S]*grid-template-columns: minmax\(0,1\.15fr\) minmax\(0,\.85fr\)/);

for (const className of [
  'tools-search',
  'tools-filters',
  'tool-card-head',
  'tool-card-title',
  'tool-parameters',
  'tool-parameter-list'
]) {
  assert.match(tools, new RegExp(className));
  assert.match(css, new RegExp(`\\.${className}\\b`));
}

assert.match(diagnostics, /class="diagnostic-toolbar"/);
for (const className of [
  'diagnostic-toolbar',
  'diagnostic-filter-summary',
  'diagnostic-metric',
  'diagnostic-copy',
  'diagnostic-log-list'
]) {
  assert.match(css, new RegExp(`\\.${className}\\b`));
}

assert.match(toast, /className = 'toast-region'/);
assert.match(toast, /`toast toast-\$\{variant\}`/);
assert.match(css, /\.toast-region\b/);
assert.match(css, /\.toast-info\b/);
assert.match(css, /\.toast-error\b/);

assert.match(drawer, /body\.className = 'drawer-body'/);
assert.match(drawer, /panelClass = ''/);
assert.match(css, /\.drawer-backdrop[\s\S]*rgb\(3 7 14 \/ 32%\)/);
assert.doesNotMatch(css, /\.drawer-backdrop[^}]*backdrop-blur/s);
assert.match(css, /\.session-detail-drawer[\s\S]*820px/);

assert.doesNotMatch(emptyState, /style\.cssText|style="/);
assert.match(emptyState, /empty empty-state/);
assert.match(css, /\.empty-state-title\b/);
assert.match(css, /\.empty-state-copy\b/);

console.log('Tailwind UI contract smoke test passed.');
