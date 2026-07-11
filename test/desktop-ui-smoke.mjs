import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const dashboardTokens = read('src/ui/tokens.css');
const electronCss = read('electron/renderer/app.css');
const dashboardJs = read('public/dashboard.js');
const dashboardHome = read('src/ui/sections/home.js');
const dashboardTools = read('src/ui/sections/tools.js');

function tokenValue(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const match = source.match(new RegExp(String.raw`${escaped}\s*:\s*([^;]+);`));
  assert.ok(match, `Missing token ${name}`);
  return match[1].trim().replace(/\s+/g, ' ');
}

for (const name of ['--bg', '--surface', '--surface-2', '--surface-3', '--text', '--text-muted', '--text-dim', '--blue', '--green', '--yellow', '--red']) {
  assert.equal(tokenValue(electronCss, name), tokenValue(dashboardTokens, name), `${name} must match between Electron and dashboard themes`);
}

for (const file of ['electron/renderer/status.html', 'electron/renderer/wizard.html', 'electron/renderer/settings.html']) {
  const html = read(file);
  assert.match(html, /<link rel="stylesheet" href="app\.css">/);
  assert.doesNotMatch(html, /<style\b/i, `${file} must use the shared Electron stylesheet`);
}

const wizardHtml = read('electron/renderer/wizard.html');
const wizardJs = read('electron/renderer/wizard.js');
assert.match(wizardHtml, /Step 2 of 4/);
assert.match(wizardHtml, /Step 3 of 4/);
assert.match(wizardHtml, /Step 4 of 4/);
assert.doesNotMatch(wizardHtml, /id="step5"/);
assert.match(wizardHtml, /id="toggleNgrokTokenBtn"/);
assert.match(wizardHtml, /id="reviewSetupBtn"[^>]*disabled/);
assert.match(wizardJs, /const STEP_COUNT = 4/);
assert.match(wizardJs, /validateLocalFields/);
assert.match(wizardJs, /validateConnectionFields/);
assert.match(wizardJs, /handleEnter/);

const statusHtml = read('electron/renderer/status.html');
const statusJs = read('electron/renderer/status.js');
const preloadJs = read('electron/preload.js');
const ipcHandlers = read('electron/ipc-handlers.js');
assert.match(statusHtml, /id="serverToggleBtn"/);
assert.match(statusHtml, /data-disclosure="service"/);
assert.match(statusHtml, /id="notificationToggleBtn"/);
assert.match(statusHtml, /Desktop notifications/);
assert.match(statusHtml, /id="localHealthCard"/);
assert.match(statusHtml, /id="publicHealthCard"/);
assert.match(statusHtml, /id="lastTaskCard"/);
assert.match(statusHtml, /role="switch"/);
assert.match(statusHtml, /id="copyDiagnosticsBtn"/);
assert.match(statusJs, /showDesktopNotification/);
assert.match(statusJs, /syncNotificationPreference/);
assert.match(statusJs, /setNotificationsEnabled/);
assert.match(preloadJs, /notifications:get-enabled/);
assert.match(preloadJs, /notifications:set-enabled/);
assert.match(ipcHandlers, /getNotificationsEnabled/);
assert.match(ipcHandlers, /setNotificationsEnabled/);
assert.match(statusJs, /diagnosticSummary/);
assert.match(statusJs, /heroView/);
assert.match(statusJs, /Rel\.AI can now receive workspace tasks from ChatGPT/);
assert.match(statusJs, /60 seconds after its latest tool call/);
assert.match(statusJs, /renderLastTask/);
assert.match(statusJs, /activity-pulse/);
assert.match(statusJs, /initDisclosures/);
assert.match(electronCss, /prefers-color-scheme: light/);
assert.match(electronCss, /status-details::details-content/);
assert.match(electronCss, /button\[data-state="success"\]/);
assert.match(electronCss, /status-health-grid/);
assert.match(electronCss, /notification-switch/);
assert.match(electronCss, /settings-shell/);

const settingsHtml = read('electron/renderer/settings.html');
const settingsJs = read('electron/renderer/settings.js');
assert.match(settingsHtml, /Rel\.AI MCP Settings/);
assert.match(settingsHtml, /Save and restart/);
assert.match(settingsHtml, /Dashboard approval token/);
assert.match(settingsJs, /restart: true/);
assert.match(settingsJs, /getNotificationsEnabled/);
assert.match(settingsJs, /closeWizard/);
assert.doesNotMatch(settingsHtml, /Step \d of 4/);

assert.match(dashboardJs, /dataset\.surface = surface/);
assert.match(dashboardJs, /history\.replaceState/);
assert.match(dashboardJs, /activeTaskCount/);
assert.match(dashboardJs, /active tool call/);
assert.match(dashboardHome, /taskActivityCard/);
assert.match(dashboardHome, /ChatGPT is working/);
assert.doesNotMatch(dashboardTools, /bundle path|apply_bundle/);
for (const file of ['electron/renderer/status.html', 'electron/renderer/settings.html', 'electron/renderer/wizard.html']) {
  assert.doesNotMatch(read(file), /Open in browser/i, `${file} must not add an Open in browser control`);
}

console.log('Desktop UI smoke test passed.');
