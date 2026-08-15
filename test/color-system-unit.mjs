import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  THEME_NAMES,
  COLOR_THEMES,
  semanticEntries,
  renderDashboardTokenCss,
  renderElectronTokenCss,
  renderColorReferenceSvg,
  contrastRatio
} from '../src/ui/colorTokens.mjs';
import { pillClass, pillHtml } from '../src/ui/components/pill.js';
import { statusDotClass, statusTone } from '../src/ui/status-tone.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function expectContrast(themeName, foregroundRole, backgroundRole, threshold) {
  const theme = COLOR_THEMES[themeName];
  const ratio = contrastRatio(theme[foregroundRole], theme[backgroundRole]);
  assert.ok(
    ratio >= threshold,
    `${themeName}.${foregroundRole} on ${backgroundRole} is ${ratio.toFixed(2)}:1; expected at least ${threshold}:1`
  );
}

assert.deepEqual(THEME_NAMES, ['dark', 'light']);
assert.equal(COLOR_THEMES.dark.canvas, '#0a0a0a', 'dark canvas must stay neutral carbon instead of carrying a green tint');
assert.equal(COLOR_THEMES.dark.surfacePrimary, '#111111', 'dark primary surfaces must stay neutral');
assert.equal(COLOR_THEMES.dark.surfaceSecondary, '#171717', 'dark secondary surfaces must stay neutral');
assert.equal(COLOR_THEMES.dark.surfaceRaised, '#1f1f1f', 'dark raised surfaces must stay neutral');
assert.equal(COLOR_THEMES.dark.selectionBackground, '#242424', 'selection feedback must use a neutral surface so lime remains an accent');
assert.equal(COLOR_THEMES.dark.actionPrimary, '#d8ff74', 'dark primary action must use the website brand lime');
assert.equal(COLOR_THEMES.dark.statusInfoForeground, '#5aa6ff', 'informational state must retain the website info blue');
assert.doesNotMatch(COLOR_THEMES.dark.electronAppGradient, /216,255,116|79,224,154/, 'Electron app background must not restore ambient lime or green glows');
assert.notEqual(COLOR_THEMES.dark.actionPrimary, COLOR_THEMES.dark.statusInfoForeground, 'brand actions and informational state must remain semantically distinct');
assert.equal(COLOR_THEMES.light.actionPrimary, '#657f00', 'light primary action must use the accessible brand-relative value');
assert.notEqual(COLOR_THEMES.dark.selectionBackground, COLOR_THEMES.dark.statusInfoBackground, 'brand selection feedback must not reuse informational blue');
assert.deepEqual(
  Object.keys(COLOR_THEMES.dark).sort(),
  Object.keys(COLOR_THEMES.light).sort(),
  'light and dark themes must expose identical semantic roles'
);

for (const themeName of THEME_NAMES) {
  for (const foreground of ['textPrimary', 'textSecondary', 'textTertiary']) {
    for (const background of ['surfacePrimary', 'surfaceSecondary']) {
      expectContrast(themeName, foreground, background, 4.5);
    }
  }
  for (const background of ['actionPrimary', 'actionPrimaryHover', 'actionPrimaryActive']) {
    expectContrast(themeName, 'actionPrimaryForeground', background, 4.5);
  }
  for (const tone of ['Info', 'Success', 'Warning', 'Danger']) {
    expectContrast(themeName, `status${tone}Foreground`, `status${tone}Background`, 4.5);
  }
  for (const background of ['surfacePrimary', 'surfaceSecondary']) {
    expectContrast(themeName, 'focusRing', background, 3);
    expectContrast(themeName, 'borderControl', background, 3);
  }
}

for (const themeName of THEME_NAMES) {
  const defined = new Set(semanticEntries(themeName).map(([property]) => property));
  for (const relativePath of ['src/ui/styles/app.css', 'electron/renderer/app.css']) {
    for (const match of read(relativePath).matchAll(/var\((--ui-[a-z0-9-]+)/g)) {
      assert.ok(defined.has(match[1]), `${relativePath} references undefined semantic token ${match[1]}`);
    }
  }
}

assert.equal(read('src/ui/styles/color-tokens.css'), renderDashboardTokenCss(), 'dashboard color tokens must match the ESM manifest');
assert.equal(read('electron/renderer/color-tokens.css'), renderElectronTokenCss(), 'Electron color tokens must match the ESM manifest');
assert.equal(read('docs/color-system-reference.svg'), renderColorReferenceSvg(), 'the color reference SVG must match the ESM manifest');

const legacyProperties = [
  '--bg', '--surface', '--surface-2', '--surface-3', '--surface-subtle',
  '--text', '--text-muted', '--text-dim', '--muted', '--line', '--line-soft',
  '--blue', '--blue-dim', '--green', '--green-dim', '--yellow', '--yellow-dim',
  '--red', '--red-dim', '--accent', '--ring', '--scrollbar-track', '--scrollbar-thumb',
  '--scrollbar-thumb-hover', '--scrollbar-thumb-active', '--scrollbar-corner',
  '--shadow-window', '--shadow-popover', '--grad-surface', '--grad-accent', '--grad-app',
  '--elev-1', '--elev-2', '--glow-accent', '--glow-green'
];
for (const relativePath of [
  'src/ui/styles/app.css',
  'electron/renderer/app.css',
  'src/ui/styles/color-tokens.css',
  'electron/renderer/color-tokens.css'
]) {
  const source = read(relativePath);
  for (const property of legacyProperties) {
    assert.equal(source.includes(property), false, `${relativePath} retains removed compatibility property ${property}`);
  }
}

const authoredUiFiles = ['src/http/auth.js', 'electron/dashboard-window.js'];
function collectUiFiles(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) collectUiFiles(relativePath);
    else if (/\.(?:css|html|m?js|svg)$/i.test(entry.name)) authoredUiFiles.push(relativePath);
  }
}
collectUiFiles('src/ui');
collectUiFiles('electron/renderer');

const rawColorAllowList = new Set([
  'src/ui/colorTokens.mjs',
  'src/ui/styles/color-tokens.css',
  'electron/renderer/color-tokens.css'
]);
const literalPattern = /(?<!&)#[0-9a-f]{3,8}\b|rgba?\(|\brgb\(/i;
for (const relativePath of authoredUiFiles) {
  if (rawColorAllowList.has(relativePath)) continue;
  assert.doesNotMatch(read(relativePath), literalPattern, `${relativePath} must consume semantic tokens or generated CSS instead of raw colors`);
}

assert.equal(fs.existsSync(path.join(root, 'src/ui/colorTokens.js')), false, 'the CommonJS color module must be deleted');
const manifestSource = read('src/ui/colorTokens.mjs');
const generatorSource = read('scripts/generate-color-tokens.mjs');
assert.match(manifestSource, /export const COLOR_THEMES/);
assert.doesNotMatch(manifestSource, /module\.exports|\brequire\s*\(/);
assert.match(generatorSource, /from '\.\.\/src\/ui\/colorTokens\.mjs'/);
assert.doesNotMatch(generatorSource, /createRequire|\brequire\s*\(/);
assert.doesNotMatch(generatorSource, /LEGACY_ALIASES/);

const dashboardCss = read('src/ui/styles/app.css');
const systemCss = read('src/ui/features/system/styles.css');
assert.match(dashboardCss, /\.status-pill\.open, \.status-pill\.working, \.status-pill\.waiting[\s\S]*--ui-status-info-foreground/);
assert.match(dashboardCss, /\.status-pill\.warn, \.status-pill\.incomplete[\s\S]*--ui-status-warning-foreground/);
assert.doesNotMatch(dashboardCss, /\.status-pill\.warn[^{]*\.status-pill\.working/);
assert.match(dashboardCss, /button\.primary[\s\S]*--ui-action-primary-foreground/);
assert.match(dashboardCss, /button:disabled[\s\S]*--ui-text-disabled/);
assert.doesNotMatch(systemCss, /--ui-surface-muted/, 'System UI must not reference an undefined semantic surface token');
assert.match(systemCss, /\.chatgpt-first-prompt[^{]*\{[^}]*--ui-surface-secondary/s, 'ChatGPT first-prompt guidance must use a defined semantic surface token');

const electronCss = read('electron/renderer/app.css');
assert.match(electronCss, /button\.primary[\s\S]*--ui-action-primary-foreground/);
assert.match(electronCss, /status-badge\.connecting::before[^}]*--ui-status-info-foreground/);
assert.match(electronCss, /status-badge\.working::before[\s\S]*--ui-status-info-foreground/);
assert.match(electronCss, /status-badge\.waiting::before[\s\S]*--ui-status-info-foreground/);
assert.match(electronCss, /status-health-card\.connecting \.health-dot[^}]*--ui-status-info-foreground/);

for (const relativePath of ['electron/renderer/status.html', 'electron/renderer/wizard.html']) {
  const html = read(relativePath);
  assert.ok(html.indexOf('color-tokens.css') < html.indexOf('app.css'), `${relativePath} must load generated tokens before component CSS`);
}

const auth = read('src/http/auth.js');
assert.doesNotMatch(auth, /oauth|public\/oauth\.css/i, 'local dashboard authorization must not restore the removed OAuth UI');
const dashboardWindow = read('electron/dashboard-window.js');
const startupBackground = read('electron/startup-background.js');
assert.doesNotMatch(dashboardWindow, /colorTokens|getTheme\('dark'\)/);
assert.match(dashboardWindow, /backgroundColor:\s*STARTUP_BACKGROUND_COLOR/);
assert.match(startupBackground, /STARTUP_BACKGROUND_COLOR\s*=\s*'#[0-9a-f]{6}'/i);
assert.doesNotMatch(startupBackground, /colorTokens|getTheme|require\s*\(/);

assert.match(read('src/ui/components/toast.js'), /toast-marker/);

const statusExpectations = Object.freeze({
  danger: [
    'blocked', 'validation_failed', 'failed', 'error', 'unavailable', 'needs attention'
  ],
  warning: [
    'waiting_for_approval', 'approval', 'input_required', 'degraded', 'paused', 'stale',
    'capability_mismatch', 'orphaned', 'not configured', 'warning', 'unsupported'
  ],
  information: [
    'queued', 'planning', 'running', 'validating', 'working', 'active', 'starting', 'stopping',
    'connecting', 'reconnecting', 'open', 'waiting', 'settling', 'info', 'live', 'checking',
    'downloading', 'installing'
  ],
  success: [
    'completed', 'succeeded', 'ready', 'passed', 'available', 'connected', 'exited', 'downloaded', 'up_to_date'
  ],
  neutral: [
    'cancelled', 'stopped', 'idle', 'inactive', 'expired', 'unknown', 'offline', 'disabled', 'disconnected'
  ]
});
const pillClasses = { danger: 'bad', warning: 'warn', information: 'working', success: 'ok', neutral: '' };
const dotClasses = { danger: 'bad', warning: 'warn', information: 'info', success: '', neutral: 'neutral' };
for (const [tone, statuses] of Object.entries(statusExpectations)) {
  for (const status of statuses) {
    assert.equal(statusTone(status), tone, `${status} must use the ${tone} semantic tone`);
    assert.equal(pillClass(status), pillClasses[tone], `${status} must use the expected pill class`);
    assert.equal(statusDotClass(status), dotClasses[tone], `${status} must use the expected dot class`);
    assert.match(pillHtml(status), new RegExp(`\\(${tone}\\)`), `${status} must expose its semantic tone to assistive technology`);
  }
}

assert.match(systemCss, /\.diagnostic-finding\.warning[^}]*--ui-status-warning-foreground/);
assert.match(systemCss, /\.diagnostic-finding\.error[^}]*--ui-status-danger-foreground/);
assert.match(systemCss, /\.diagnostic-log-row\.info[^}]*--ui-status-info-foreground/);
assert.match(systemCss, /\.diagnostic-log-row\.warning[^}]*--ui-status-warning-foreground/);
assert.match(systemCss, /\.diagnostic-log-row\.error[^}]*--ui-status-danger-foreground/);
assert.match(dashboardCss, /\.dot\.neutral[^}]*--ui-status-neutral-foreground/);
assert.match(systemCss, /\.connection-summary-card\.working[^}]*--ui-status-info-foreground/);
assert.match(systemCss, /\.connection-path-step\.working \.connection-layer-dot[^}]*--ui-status-info-foreground/);
assert.match(systemCss, /\.connection-layer-state\.working[^}]*--ui-status-info-foreground/);

console.log('ESM color-system hard-cutover, contrast, exhaustive status-tone mapping, and raw-color checks passed.');
