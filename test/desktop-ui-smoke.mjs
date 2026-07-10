import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const dashboardTokens = read('src/ui/tokens.css');
const electronCss = read('electron/renderer/app.css');

function tokenValue(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const match = source.match(new RegExp(String.raw`${escaped}\s*:\s*([^;]+);`));
  assert.ok(match, `Missing token ${name}`);
  return match[1].trim().replace(/\s+/g, ' ');
}

for (const name of ['--bg', '--surface', '--surface-2', '--surface-3', '--text', '--text-muted', '--text-dim', '--blue', '--green', '--yellow', '--red']) {
  assert.equal(tokenValue(electronCss, name), tokenValue(dashboardTokens, name), `${name} must match between Electron and dashboard themes`);
}

for (const file of ['electron/renderer/status.html', 'electron/renderer/wizard.html']) {
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
assert.match(statusHtml, /id="serverToggleBtn"/);
assert.match(statusHtml, /data-disclosure="connection"/);
assert.match(statusHtml, /id="notificationToggleBtn"/);
assert.match(statusHtml, /id="copyDiagnosticsBtn"/);
assert.match(statusJs, /showDesktopNotification/);
assert.match(statusJs, /diagnosticSummary/);
assert.match(statusJs, /initDisclosures/);
assert.match(electronCss, /prefers-color-scheme: light/);
assert.match(electronCss, /status-details::details-content/);
assert.match(electronCss, /button\[data-state="success"\]/);

console.log('Desktop UI smoke test passed.');
