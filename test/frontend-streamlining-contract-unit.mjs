import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLICATION_NAV_ITEMS, MOBILE_NAV_ITEMS, SETTINGS_NAV_ITEMS, SYSTEM_NAV_ITEMS, WORK_NAV_ITEMS, desktopNavigationOwner } from '../src/ui/navigation-catalog.js';
import { workspaceMenuHtml } from '../src/ui/components/workspace-menu.js';
import { canonicalPathFor, normalizeRouteKey } from '../src/ui/route-policy.js';
import { chatGptFirstPrompt, chatGptGuideSteps } from '../src/ui/features/settings/connection-guidance.js';
import { connectionLayerViews } from '../src/ui/connection-state.js';
import { connectionGuideMode, connectionPrimaryAction } from '../src/ui/features/settings/connector.js';
import { desktopSetupItems } from '../src/ui/features/onboarding/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

assert.deepEqual(WORK_NAV_ITEMS.map(item => item.id), ['home', 'tasks', 'workspaces', 'activity']);
assert.deepEqual(SYSTEM_NAV_ITEMS.map(item => item.id), ['connection', 'processes', 'diagnostics', 'tools', 'usage']);
assert.deepEqual(APPLICATION_NAV_ITEMS.map(item => item.id), ['system', 'settings']);
assert.deepEqual(MOBILE_NAV_ITEMS.map(item => item.id), ['home', 'tasks', 'workspaces', 'system', 'settings']);
assert.deepEqual(SETTINGS_NAV_ITEMS.map(item => item.label), ['Preferences', 'Skills', 'Application', 'Advanced', 'About']);
assert.equal(desktopNavigationOwner('connection'), 'system');
assert.equal(desktopNavigationOwner('diagnostics'), 'system');
assert.equal(desktopNavigationOwner('system'), 'system');
assert.equal(desktopNavigationOwner('settings'), 'settings');

assert.equal(canonicalPathFor('settings/connection'), 'connection');
assert.equal(canonicalPathFor('settings/diagnostics'), 'diagnostics');
assert.equal(canonicalPathFor('settings/tools-validation'), 'home');
assert.equal(canonicalPathFor('settings/skills'), 'settings/skills');
assert.equal(canonicalPathFor('skills'), 'settings/skills');
assert.equal(normalizeRouteKey('activity?status=succeeded'), 'activity?status=succeeded');
assert.equal(normalizeRouteKey('activity?status=active'), 'activity?status=active');
assert.equal(normalizeRouteKey('activity?status=failed'), 'activity?status=failed');
assert.equal(normalizeRouteKey('activity?status=other'), 'activity?status=other');

const createSteps = chatGptGuideSteps({ mode: 'create', endpointAvailable: true, developerModeRequired: true }).join(' ');
assert.match(createSteps, /Plus or Pro.*Plugins/i);
assert.match(createSteps, /Business, Enterprise, or Edu.*workspace Apps/i);
assert.match(createSteps, /OAuth/);
assert.match(createSteps, /refresh or scan/i);
assert.match(createSteps, /approval token/i);
assert.match(createSteps, /enable.*select Rel\.AI MCP/i);
const reconnectSteps = chatGptGuideSteps({ mode: 'reconnect' }).join(' ');
assert.match(reconnectSteps, /Plus or Pro.*Plugins/i);
assert.match(reconnectSteps, /existing Rel\.AI MCP integration/);
assert.match(reconnectSteps, /endpoint is unchanged/i);
assert.match(reconnectSteps, /do not delete or recreate/i);
const firstPrompt = chatGptFirstPrompt();
assert.match(firstPrompt, /start a work session/i);
assert.match(firstPrompt, /snapshot/i);
assert.match(firstPrompt, /do not modify files yet/i);

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
  chatgptReadiness: { status: 'oauth_authorized' },
  mcpClient: { status: 'idle' },
  dashboardUpdates: { status: 'live' }
};
assert.deepEqual(
  connectionLayerViews(readyConnection).map(layer => layer.title),
  ['Connection service', 'Secure endpoint', 'Authorization', 'Client and tools', 'Dashboard updates']
);
assert.deepEqual(
  connectionPrimaryAction({ chatgptMcpUrl: '' }, { ...readyConnection, publicEndpoint: { status: 'disabled' } }),
  { kind: 'control', target: 'tunnelSettings', label: 'Configure tunnel' }
);
assert.deepEqual(
  connectionPrimaryAction(
    { chatgptMcpUrl: 'https://example.ngrok-free.dev/mcp' },
    { ...readyConnection, chatgptReadiness: { status: 'authentication_required' } }
  ),
  { kind: 'control', target: 'approvalTokenSettings', label: 'Review approval token' }
);
assert.deepEqual(
  connectionPrimaryAction({ chatgptMcpUrl: 'https://example.ngrok-free.dev/mcp' }, readyConnection),
  { kind: 'route', href: '#tasks', label: 'Open work sessions' }
);
assert.equal(connectionGuideMode({ ...readyConnection, chatgptReadiness: { status: 'awaiting_authentication' } }), 'create');
assert.equal(connectionGuideMode({ ...readyConnection, chatgptReadiness: { status: 'authentication_required' } }), 'reconnect');
assert.equal(connectionGuideMode(readyConnection), null);

const wizard = read('electron/renderer/wizard.html');
assert.equal((wizard.match(/data-step="\d+"/g) || []).length, 3);
assert.doesNotMatch(wizard, /data-step="[45]"/);
assert.match(wizard, /Connect ChatGPT/);
assert.match(wizard, /Sign in or create account/);
assert.match(wizard, /Plus or Pro[\s\S]*Plugins/i);
assert.match(wizard, /Business, Enterprise, or Edu[\s\S]*workspace Apps/i);
assert.match(wizard, /Secure this device/);
assert.match(wizard, /Continue to dashboard/);
assert.match(wizard, /Advanced setup and recovery/);
assert.match(wizard, /Direct connection/);
assert.match(wizard, /id="advancedSetup"/);
assert.match(wizard, /id="directNgrokTokenInput"/);
assert.match(wizard, /id="directDomainInput"/);

assert.equal(fs.existsSync(path.join(root, 'src/ui/features/settings/tools-validation.js')), false);
assert.match(workspaceMenuHtml([], ''), /aria-label="Workspace scope: All workspaces"/);
assert.match(read('src/ui/features/settings/diagnostics.js'), /value: 'all', label: 'Everything'/);
const appCss = read('src/ui/styles/app.css');
assert.match(appCss, /mobile-nav[^}]*grid-template-columns:\s*repeat\(5,minmax\(0,1fr\)\)/s, 'five top-level mobile destinations must share one row before the compact breakpoint');
for (const selector of ['.settings-shell', '.connection-page', '.tools-grid', '.diagnostic-page', '.workspace-grid', '.processes-card']) {
  assert.doesNotMatch(appCss, new RegExp(selector.replace('.', '\\.')), `app.css still owns feature selector ${selector}`);
}

for (const featureStyle of [
  'src/ui/features/home/styles.css',
  'src/ui/features/onboarding/styles.css',
  'src/ui/features/settings/styles.css',
  'src/ui/features/skills/styles.css',
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
assert.match(workspaceCards, /data-repository-details=/, 'workspace cards must expose Repository details as a visible action');
assert.match(workspaceCards, />Repository details</, 'Repository details must be named directly instead of hidden behind generic safety wording');
assert.match(workspaceActions, /\[data-repository-details\]/, 'the visible Repository details action must remain wired');
assert.match(workspaceActions, /openModal/, 'Repository details must open in the shared modal surface');
assert.match(workspaceActions, /Repository details/, 'Repository details modal must keep the explicit product label');
assert.doesNotMatch(read('src/ui/features/workspaces/details.js'), /<details class="workspace-details">/, 'Repository details must not remain an inline disclosure');
const connectorSource = read('src/ui/features/settings/connector.js');
assert.match(connectorSource, /card connection-layer-disclosure connector-details|card connector-details connection-layer-disclosure/, 'Connection layers must share the aligned connector disclosure contract');
assert.doesNotMatch(read('src/ui/features/settings/advanced.js'), /Patch limit \(MiB\)/, 'patch sizing must not remain a normal user setting');

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


