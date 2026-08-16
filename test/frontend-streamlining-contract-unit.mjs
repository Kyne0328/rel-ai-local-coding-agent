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
import { connectionRestartResult } from '../src/ui/features/settings/connection-recovery.js';
import { desktopSetupItems } from '../src/ui/features/onboarding/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

assert.deepEqual(WORK_NAV_ITEMS.map(item => item.id), ['home', 'tasks', 'workspaces', 'activity']);
assert.deepEqual(SYSTEM_NAV_ITEMS.map(item => item.id), ['connection', 'processes', 'diagnostics', 'tools', 'usage']);
assert.equal(SYSTEM_NAV_ITEMS.find(item => item.id === 'usage')?.label, 'Analytics', 'the dedicated analytics page must use the same name as Overview links');
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
  connectionPrimaryAction({ ...readyConnection, publicEndpoint: { status: 'unavailable' } }),
  { kind: 'restart', label: 'Restart connection' }
);
assert.equal(connectionRestartResult({ serverRunning: true, tunnelStatus: 'running' }).ok, true);
const failedRestart = connectionRestartResult({ serverRunning: true, tunnelStatus: 'failed' });
assert.equal(failedRestart.ok, false);
assert.match(failedRestart.error, /Tunnel ID and runtime API key/);
assert.deepEqual(
  connectionPrimaryAction({ ...readyConnection, publicEndpoint: { status: 'connecting' } }),
  { kind: 'none' }
);
assert.deepEqual(
  connectionPrimaryAction({ ...readyConnection, mcpClient: { status: 'request_failed' } }),
  { kind: 'route', href: '#diagnostics', label: 'Troubleshoot' }
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
const diagnosticsSource = read('src/ui/features/settings/diagnostics.js');
const statusRendererSource = read('electron/renderer/status.js');
assert.doesNotMatch(statusRendererSource, /setInterval\(renderTemporalText/, 'fallback status clock must not run a permanent one-second interval');
assert.match(statusRendererSource, /addEventListener\('visibilitychange', ensureClock\)/, 'fallback status clock must pause while hidden');
assert.match(statusRendererSource, /lastWindowFit/, 'fallback status window fitting must cache the last requested dimensions');
const homeSource = read('src/ui/features/home/index.js');
assert.match(homeSource, /patchHomeNode/, 'Overview live updates should patch stable DOM instead of replacing whole regions');
assert.match(homeSource, /data-home-analytics/, 'Overview analytics preview must remain available');
assert.match(diagnosticsSource, /value: 'all', label: 'Everything'/);
assert.match(diagnosticsSource, /document\.visibilityState === 'hidden'/, 'hidden diagnostics tabs must pause live-tail requests');
assert.match(diagnosticsSource, /relai:diagnostics-live/, 'diagnostics live tail must use the shared SSE event stream');
assert.doesNotMatch(diagnosticsSource, /setInterval\(refreshLiveTail|LIVE_TAIL_INTERVAL_MS/, 'diagnostics must not poll the full report on a fixed interval');
assert.match(diagnosticsSource, /role="status" aria-live="polite"/, 'diagnostics should use a narrow status announcer for significant live updates');
assert.doesNotMatch(diagnosticsSource, /role="log" aria-live=/, 'the entire changing log must not be an aria-live region');
assert.match(diagnosticsSource, /captureLogScrollState/, 'diagnostic refreshes must preserve users reading older logs');
assert.match(diagnosticsSource, /previous\.follow/, 'diagnostic logs should auto-follow only when the user was already near the tail');
assert.match(diagnosticsSource, /findingSeverityLabel/, 'diagnostic findings should translate internal severities into user-facing labels');
assert.doesNotMatch(diagnosticsSource, /class="diagnostic-code"/, 'diagnostic finding codes must stay inside Technical details');
assert.match(diagnosticsSource, /Live updates on/, 'troubleshooting controls should use familiar live-update wording');
const toolsSource = read('src/ui/features/tools/index.js');
assert.match(toolsSource, /Tool catalog unavailable/);
assert.match(toolsSource, /cta: 'Retry'/);
assert.match(toolsSource, /result\?\.ok === false \|\| tools == null/, 'tool API failures must not masquerade as an empty catalog');
const appCss = read('src/ui/styles/app.css');
assert.match(appCss, new RegExp(`mobile-nav[^}]*grid-template-columns:\\s*repeat\\(${MOBILE_NAV_ITEMS.length},`, 's'), 'mobile navigation must allocate one grid column per current top-level destination');
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
const workspaceFormSource = read('src/ui/features/workspaces/form.js');
const workspaceRepairSource = read('src/ui/features/workspaces/repair.js');
assert.match(workspaceCards, /data-repository-details=/, 'project cards must keep Project details available');
assert.match(workspaceCards, />Project details</, 'Project details must keep its plain product label');
assert.match(workspaceCards, /workspace-action-menu/, 'lower-frequency project actions should be grouped behind More');
assert.match(workspaceCards, /data-run-validation=/, 'Run checks must remain directly available on project cards');
assert.match(workspaceCards, /const title = finding\.message \|\| humanizeFindingCode/, 'project health rows should lead with a user-facing problem description instead of an internal finding code');
assert.match(workspaceCards, /pillHtml\(findingSeverityLabel\(finding\.severity\), statusClass\(finding\.severity\)\)/, 'project health badges should use the same readable severity language as Troubleshooting');
assert.match(workspaceActions, /\[data-repository-details\]/, 'the visible Project details action must remain wired');
assert.match(workspaceActions, /openModal/, 'Project details must open in the shared modal surface');
assert.match(workspaceActions, /Project details/, 'Project details modal must keep the plain product label');
assert.doesNotMatch(read('src/ui/features/workspaces/details.js'), /<details class="workspace-details">/, 'Project details must not remain an inline disclosure');
for (const source of [workspaceFormSource, workspaceRepairSource]) {
  assert.doesNotMatch(source, />Workspace settings<|>Workspace name<|>Add workspace<|>Save workspace<|>Repair workspace path</, 'Project dialogs must not expose internal workspace terminology in primary controls');
}
assert.match(workspaceFormSource, />Project name</, 'project naming must use the same product vocabulary as the Projects page');
assert.match(workspaceRepairSource, />Repair project folder</, 'project repair must describe the user goal rather than the internal workspace path');
const connectorSource = read('src/ui/features/settings/connector.js');
const desktopConnectionSource = read('src/ui/features/settings/desktop-connection.js');
const settingsSharedSource = read('src/ui/features/settings/shared.js');
assert.match(connectorSource, /card connection-layer-disclosure connector-details|card connector-details connection-layer-disclosure/, 'Connection layers must share the aligned connector disclosure contract');
assert.match(connectorSource, /mountDesktopConnection\(controls,\{expanded:String\(state\.publicEndpoint\?\.status\|\|''\)===['"]disabled['"]\}\)/, 'connection credentials should open for initial setup and stay collapsed during normal use');
assert.match(desktopConnectionSource, /connection-settings-disclosure/, 'low-frequency connection credentials should use progressive disclosure');
assert.match(settingsSharedSource, /labelElement\.htmlFor = labelTarget\.id/, 'shared settings fields must associate visible labels with their controls');
assert.doesNotMatch(connectorSource, /connection-status-body[\s\S]{0,600}field-caption[^\n]*Tunnel ID/, 'primary connection status must not duplicate technical setup identifiers');
assert.match(connectorSource, /action\.href===['"]#diagnostics['"]/, 'connection recovery must not render a duplicate Troubleshooting link beside the primary recovery action');
assert.match(connectorSource, /data-restart-connection/, 'an unavailable Secure MCP Tunnel must expose the existing desktop restart operation directly');
assert.match(diagnosticsSource, /data-restart-connection/, 'Troubleshooting must offer a direct tunnel restart instead of only routing back to Connection');
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


