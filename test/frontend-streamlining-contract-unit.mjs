import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLICATION_NAV_ITEMS, MOBILE_NAV_ITEMS, SETTINGS_NAV_ITEMS, SYSTEM_NAV_ITEMS, WORK_NAV_ITEMS, desktopNavigationOwner } from '../src/ui/navigation-catalog.js';
import { workspaceMenuHtml } from '../src/ui/components/workspace-menu.js';
import { canonicalPathFor, normalizeRouteKey } from '../src/ui/route-policy.js';
import { chatGptFirstPrompt, chatGptGuideSteps } from '../src/ui/features/settings/connection-guidance.js';
import { connectionLayerViews } from '../src/ui/connection-state.js';
import { connectionPrimaryAction } from '../src/ui/features/settings/connector.js';
import { desktopSetupItems } from '../src/ui/features/onboarding/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

assert.deepEqual(WORK_NAV_ITEMS.map(item => item.id), ['home', 'tasks', 'workspaces', 'activity']);
assert.deepEqual(SYSTEM_NAV_ITEMS.map(item => item.id), ['connection', 'processes', 'diagnostics', 'tools', 'usage']);
assert.deepEqual(APPLICATION_NAV_ITEMS.map(item => item.id), ['system', 'settings']);
assert.deepEqual(MOBILE_NAV_ITEMS.map(item => item.id), ['home', 'tasks', 'workspaces', 'activity', 'system', 'settings']);
assert.deepEqual(SETTINGS_NAV_ITEMS.map(item => item.label), ['General', 'App', 'About']);
assert.equal(desktopNavigationOwner('connection'), 'system');
assert.equal(desktopNavigationOwner('diagnostics'), 'system');
assert.equal(desktopNavigationOwner('system'), 'system');
assert.equal(desktopNavigationOwner('settings'), 'settings');

assert.equal(canonicalPathFor('settings/connection'), 'home');
assert.equal(canonicalPathFor('settings/diagnostics'), 'home');
assert.equal(canonicalPathFor('settings/tools-validation'), 'home');
assert.equal(normalizeRouteKey('activity?status=succeeded'), 'activity?status=succeeded');
assert.equal(normalizeRouteKey('activity?status=active'), 'activity?status=active');
assert.equal(normalizeRouteKey('activity?status=failed'), 'activity?status=failed');
assert.equal(normalizeRouteKey('activity?status=other'), 'activity?status=other');

const createSteps = chatGptGuideSteps({ mode: 'create', tunnelId: 'tunnel_example123456' }).join(' ');
assert.match(createSteps, /tunnel/i);
assert.match(createSteps, /API key/i);
assert.match(createSteps, /(?:Tunnel connection option|Connection set to Tunnel)/i);
assert.match(createSteps, /Authentication to No authentication/i);
assert.match(createSteps, /tunnel_example123456/i);
assert.match(createSteps, /ChatGPT/i);
assert.match(createSteps, /Rel\.AI MCP/i);
const reconnectSteps = chatGptGuideSteps({ mode: 'reconnect', tunnelId: 'tunnel_example123456' }).join(' ');
assert.match(reconnectSteps, /existing Rel\.AI MCP (?:integration|plugin\/app)/i);
assert.match(reconnectSteps, /(?:do not delete or recreate the app|instead of creating a duplicate)/i);
assert.match(reconnectSteps, /Connection set to Tunnel/i);
assert.match(reconnectSteps, /Authentication to No authentication/i);
assert.match(reconnectSteps, /tunnel_example123456/i);
const firstPrompt = chatGptFirstPrompt();
assert.match(firstPrompt, /project/i);
assert.match(firstPrompt, /files and folders/i);
assert.match(firstPrompt, /do not change any files yet/i);

for (const scenario of [
  { hasWorkspace: false, endpointReady: false, chatgptReady: false, firstRequestObserved: false, expected: ['workspace', 'connection', 'chatgpt', 'first-request'] },
  { hasWorkspace: true, endpointReady: false, chatgptReady: false, firstRequestObserved: false, expected: ['connection', 'chatgpt', 'first-request'] },
  { hasWorkspace: true, endpointReady: true, chatgptReady: false, firstRequestObserved: false, expected: ['chatgpt', 'first-request'] },
  { hasWorkspace: true, endpointReady: true, chatgptReady: true, firstRequestObserved: false, expected: ['first-request'] },
  { hasWorkspace: true, endpointReady: true, chatgptReady: true, firstRequestObserved: true, expected: [] }
]) {
  assert.deepEqual(desktopSetupItems(scenario).map(item => item.id), scenario.expected);
}

const readyConnection = {
  localService: { status: 'running' },
  publicEndpoint: { status: 'available' },
  chatgptReadiness: { status: 'ready' },
  mcpClient: { status: 'idle' },
  dashboardUpdates: { status: 'live' }
};
assert.deepEqual(
  connectionLayerViews(readyConnection).map(layer => layer.title),
  ['Local MCP service', 'OpenAI Secure MCP Tunnel', 'Ready for ChatGPT', 'MCP activity', 'Dashboard updates']
);
assert.deepEqual(
  connectionPrimaryAction({ ...readyConnection, publicEndpoint: { status: 'disabled' } }),
  { kind: 'control', label: 'Set up connection' }
);
assert.deepEqual(
  connectionPrimaryAction(readyConnection),
  { kind: 'route', href: '#tasks', label: 'Open tasks' }
);

const wizard = read('electron/renderer/wizard.html');
assert.match(wizard, /Connect Rel\.AI to ChatGPT/);
assert.match(wizard, /id="tunnelIdInput"/);
assert.match(wizard, /id="tunnelApiKeyInput"/);
assert.doesNotMatch(wizard, /ngrok|Cloud gateway|Direct connection|approval token/i);

assert.equal(fs.existsSync(path.join(root, 'src/ui/features/settings/tools-validation.js')), false);
assert.match(workspaceMenuHtml([], ''), /aria-label="Project filter: All projects"/);
assert.match(read('src/ui/features/settings/diagnostics.js'), /value: 'all', label: 'Everything'/);
const appCss = read('src/ui/styles/app.css');
assert.match(appCss, /mobile-nav[^}]*grid-template-columns:\s*repeat\(6,minmax\(52px,1fr\)\)/s, 'six top-level mobile destinations must share the responsive navigation row');
for (const selector of ['.settings-shell', '.connection-page', '.tools-grid', '.diagnostic-page', '.workspace-grid', '.processes-card']) {
  assert.doesNotMatch(appCss, new RegExp(selector.replace('.', '\\.')), `app.css still owns feature selector ${selector}`);
}

for (const featureStyle of [
  'src/ui/features/home/styles.css',
  'src/ui/features/onboarding/styles.css',
  'src/ui/features/settings/styles.css',
  'src/ui/features/system/styles.css',
  'src/ui/features/sessions/styles.css',
  'src/ui/features/activity/styles.css',
  'src/ui/features/workspaces/styles.css',
  'src/ui/features/tools/styles.css',
  'src/ui/features/processes/styles.css',
  'src/ui/components/filter-controls.css'
]) {
  assert.equal(fs.existsSync(path.join(root, featureStyle)), true, `missing feature stylesheet: ${featureStyle}`);
  assert.match(read('src/ui/styles/app.css'), new RegExp(featureStyle.replace('src/ui/', '../').replaceAll('/', '\\/').replace('.', '\\.')));
}

const workspaceCards = read('src/ui/features/workspaces/cards.js');
const workspaceActions = read('src/ui/features/workspaces/actions.js');
assert.match(workspaceCards, /data-repository-details=/, 'project cards must expose Project details as a visible action');
assert.match(workspaceCards, />Project details</, 'Project details must be named directly instead of hidden behind generic wording');
assert.match(workspaceActions, /\[data-repository-details\]/, 'the visible Project details action must remain wired');
assert.match(workspaceActions, /openModal/, 'Project details must open in the shared modal surface');
assert.match(workspaceActions, /Project details/, 'Project details modal must keep the plain product label');
assert.doesNotMatch(read('src/ui/features/workspaces/details.js'), /<details class="workspace-details">/, 'Project details must not remain an inline disclosure');
const connectorSource = read('src/ui/features/settings/connector.js');
assert.match(connectorSource, /card connection-layer-disclosure connector-details|card connector-details connection-layer-disclosure/, 'Connection layers must share the aligned connector disclosure contract');
assert.equal(fs.existsSync(path.join(root, 'src/ui/features/settings/advanced.js')), false, 'technical Advanced settings must not remain in the product surface');

const publicRouteOwners = [
  'electron/main.js',
  'src/desktopUxContracts.js',
  'src/diagnostics.js',
  'src/ui/api.js',
  'src/ui/features/sessions/index.js',
  'src/ui/features/settings/desktop-updates.js',
  'public/dashboard.js'
];
for (const relative of publicRouteOwners) {
  const source = read(relative);
  assert.doesNotMatch(source, /#settings\/(?:connection|diagnostics|tools-validation)/, `${relative} still targets a removed Settings route`);
}

console.log('Frontend streamlining contracts passed.');


