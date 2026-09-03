import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLICATION_NAV_ITEMS, MOBILE_NAV_ITEMS, SETTINGS_NAV_ITEMS, SYSTEM_NAV_ITEMS, WORK_NAV_ITEMS, desktopNavigationOwner } from '../src/ui/navigation-catalog.js';
import { workspaceMenuHtml } from '../src/ui/components/workspace-menu.js';
import { canonicalPathFor, normalizeRouteKey } from '../src/ui/route-policy.js';
import { CHATGPT_CONNECTOR_CREATE_URL, RELAI_CONNECTOR_ICON_FILENAME, RELAI_CONNECTOR_ICON_URL, chatGptFirstPrompt, chatGptGuideSteps } from '../src/ui/features/settings/connection-guidance.js';
import { connectionLayerViews, hasObservedMcpConnection, hasObservedMcpToolCall } from '../src/ui/connection-state.js';
import { connectionPrimaryAction } from '../src/ui/features/settings/connector.js';
import { connectionRestartResult } from '../src/ui/features/settings/connection-recovery.js';
import { desktopSetupItems } from '../src/ui/features/onboarding/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const onboardingSource = read('src/ui/features/onboarding/index.js');

assert.deepEqual(WORK_NAV_ITEMS.map(item => item.id), ['home', 'tasks', 'code', 'workspaces', 'activity']);
assert.equal(WORK_NAV_ITEMS.find(item => item.id === 'code')?.label, 'Changes', 'the task file surface must be presented as a read-only changes viewer');
assert.deepEqual(SYSTEM_NAV_ITEMS.map(item => item.id), ['processes', 'diagnostics', 'tools', 'usage']);
assert.equal(SYSTEM_NAV_ITEMS.find(item => item.id === 'usage')?.label, 'Analytics', 'the dedicated analytics page must use the same name as Overview links');
assert.deepEqual(APPLICATION_NAV_ITEMS.map(item => item.id), ['system', 'settings']);
assert.deepEqual(MOBILE_NAV_ITEMS.map(item => item.id), ['home', 'tasks', 'code', 'workspaces', 'activity', 'system', 'settings']);
assert.deepEqual(SETTINGS_NAV_ITEMS.map(item => item.label), ['Connection', 'General', 'App', 'About']);
assert.equal(APPLICATION_NAV_ITEMS.find(item => item.id === 'system')?.label, 'System');
assert.equal(desktopNavigationOwner('connection'), 'settings');
assert.equal(desktopNavigationOwner('diagnostics'), 'system');
assert.equal(desktopNavigationOwner('system'), 'system');
assert.equal(desktopNavigationOwner('settings'), 'settings');

assert.equal(canonicalPathFor('settings/connection'), 'settings/connection');
assert.equal(canonicalPathFor('connection'), 'home');
assert.equal(canonicalPathFor('settings/diagnostics'), 'home');
assert.equal(canonicalPathFor('settings/tools-validation'), 'home');
assert.equal(normalizeRouteKey('activity?status=succeeded'), 'activity?status=succeeded');
assert.equal(normalizeRouteKey('activity?status=active'), 'activity?status=active');
assert.equal(normalizeRouteKey('activity?status=failed'), 'activity?status=failed');
assert.equal(normalizeRouteKey('activity?status=other'), 'activity?status=other');
assert.equal(normalizeRouteKey('usage?workspace=app&range=7d'), 'usage?workspace=app&range=7d');
assert.equal(normalizeRouteKey('usage?range=custom&start=2026-08-01&end=2026-08-16'), 'usage?range=custom&start=2026-08-01&end=2026-08-16');
assert.equal(normalizeRouteKey('usage?range=invalid&start=nope'), 'usage');

const createSteps = chatGptGuideSteps({ mode: 'create', tunnelId: 'tunnel_example123456' }).join(' ');
assert.match(createSteps, /Open ChatGPT connector setup/i);
assert.doesNotMatch(createSteps, /API key|Name, Description, Organizations/i, 'ChatGPT handoff must not repeat completed tunnel setup.');
assert.match(createSteps, /Connection to Tunnel/i);
assert.match(createSteps, /Authentication to No authentication/i);
assert.match(createSteps, /Scan Tools/i);
assert.match(createSteps, /click Create/i);
assert.match(createSteps, /Manage/i);
assert.match(createSteps, /relai-mcp\.png/i);
assert.match(createSteps, /tunnel_example123456/i);
assert.match(createSteps, /ChatGPT/i);
assert.match(createSteps, /Rel\.AI MCP/i);
assert.equal(CHATGPT_CONNECTOR_CREATE_URL, 'https://chatgpt.com/plugins#settings/Connectors?create-connector=true');
assert.equal(RELAI_CONNECTOR_ICON_URL, '/assets/favicon.png');
assert.equal(RELAI_CONNECTOR_ICON_FILENAME, 'relai-mcp.png');
assert.match(onboardingSource, /createChatGptSetupGuide/, 'Overview onboarding must reuse the canonical ChatGPT connector guide after tunnel setup');
assert.match(onboardingSource, /actionType:\s*'guide'/, 'the ChatGPT onboarding step must render guidance inline instead of routing back to Connection');
assert.match(onboardingSource, /includeFirstPrompt:\s*false/, 'ChatGPT connector setup must not show a fake project prompt before a project exists');
const connectorIconBytes = fs.statSync(path.join(root, 'public', 'assets', 'favicon.png')).size;
assert.ok(connectorIconBytes < 10 * 1024, `Rel.AI connector icon must stay below 10 KB, got ${connectorIconBytes} bytes`);
assert.equal(hasObservedMcpConnection({ activityStatus: 'no_requests' }), false, 'a connected tunnel alone must not hide ChatGPT connector setup');
assert.equal(hasObservedMcpConnection({ lastRequestAt: '2026-08-16T12:00:00.000Z', activityStatus: 'recent' }), true, 'tool scanning or another MCP request proves the ChatGPT connector exists');
assert.equal(hasObservedMcpToolCall({ lastRequestMethod: 'tools/list' }), false, 'scanning tools must not count as the first Rel.AI tool request');
assert.equal(hasObservedMcpToolCall({ recentEvents: [{ method: 'tools/call' }] }), true, 'a tools/call request completes the first-request onboarding step');
const reconnectSteps = chatGptGuideSteps({ mode: 'reconnect', tunnelId: 'tunnel_example123456' }).join(' ');
assert.match(reconnectSteps, /changed ChatGPT accounts or workspaces/i);
assert.match(reconnectSteps, /Rel\.AI MCP.*already exists.*instead of creating a duplicate/i);
assert.match(reconnectSteps, /does not exist.*create it once/i);
assert.match(reconnectSteps, /Connection to Tunnel/i);
assert.match(reconnectSteps, /Authentication to No authentication/i);
assert.match(reconnectSteps, /tunnel_example123456/i);
const firstPrompt = chatGptFirstPrompt();
assert.match(firstPrompt, /project/i);
assert.match(firstPrompt, /files and folders/i);
assert.match(firstPrompt, /do not change any files yet/i);

for (const scenario of [
  { hasWorkspace: false, endpointReady: false, chatgptReady: false, firstRequestObserved: false, expected: ['connection', 'chatgpt', 'workspace', 'first-request'] },
  { hasWorkspace: false, endpointReady: true, chatgptReady: true, firstRequestObserved: true, expected: ['workspace', 'first-request'] },
  { hasWorkspace: true, endpointReady: false, chatgptReady: false, firstRequestObserved: false, expected: ['connection', 'chatgpt', 'first-request'] },
  { hasWorkspace: true, endpointReady: false, chatgptReady: true, firstRequestObserved: true, expected: ['connection', 'chatgpt', 'first-request'] },
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
  ['Local Rel.AI service', 'OpenAI Secure MCP Tunnel', 'Ready for ChatGPT', 'ChatGPT requests', 'Dashboard updates']
);
assert.deepEqual(
  connectionPrimaryAction({ ...readyConnection, publicEndpoint: { status: 'disabled' } }),
  { kind: 'control', label: 'Set up connection' }
);
assert.deepEqual(
  connectionPrimaryAction({ ...readyConnection, publicEndpoint: { status: 'unavailable' } }),
  { kind: 'restart', label: 'Retry now' }
);
assert.deepEqual(
  connectionPrimaryAction({ ...readyConnection, publicEndpoint: { status: 'degraded' }, error: { code: 'tunnel_connection_interrupted', message: 'offline' } }),
  { kind: 'restart', label: 'Retry now' }
);
assert.deepEqual(
  connectionPrimaryAction({ ...readyConnection, publicEndpoint: { status: 'unavailable' }, error: { code: 'tunnel_authentication_failed', message: 'rejected' } }),
  { kind: 'settings', label: 'Replace runtime key' }
);
assert.deepEqual(
  connectionPrimaryAction({ ...readyConnection, publicEndpoint: { status: 'unavailable' }, error: { code: 'tunnel_access_denied', message: 'forbidden' } }),
  { kind: 'settings', label: 'Review key permissions' }
);
assert.deepEqual(
  connectionPrimaryAction({ ...readyConnection, publicEndpoint: { status: 'unavailable' }, error: { code: 'tunnel_not_found', message: 'missing' } }),
  { kind: 'settings', label: 'Review Tunnel ID' }
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
assert.match(wizard, /Connect this computer to OpenAI/);
assert.match(wizard, /Before you start/);
assert.doesNotMatch(wizard, /Support Rel\.AI on GitHub|supportProject/);
assert.match(wizard, /id="tunnelIdInput"/);
assert.match(wizard, /id="tunnelApiKeyInput"/);
assert.match(wizard, /id="runtimeKeyToggle"[^>]*aria-controls="tunnelApiKeyInput"/, 'setup should let users verify the runtime API key they pasted');
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
assert.match(homeSource, /data-home-analytics/, 'Overview analytics preview must remain available after setup');
assert.match(homeSource, /postSetup = setupState\.firstRequestObserved/, 'Overview must hide post-setup content until the first real Rel.AI request');
assert.match(homeSource, /postSetup \? recentTasksCard/, 'Latest tasks must use the same first-request progressive-disclosure boundary');
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
assert.match(diagnosticsSource, /Pause live updates|Start live updates/, 'troubleshooting live updates should remain explicitly labeled for assistive technology');
const changesSource = read('src/ui/features/code/index.js');
assert.match(changesSource, /Read-only diff/, 'the Changes surface must clearly identify its read-only diff mode');
assert.match(changesSource, /readOnly:\s*true/, 'Monaco must be configured as read-only');
assert.doesNotMatch(changesSource, /data-code-save|saveCurrentFile|markUnsaved|confirmDiscard/, 'the Changes surface must not retain embedded editing or save flows');
assert.doesNotMatch(read('electron/preload.cjs'), /desktop:code:write|desktop:code:read/, 'the desktop preload must not expose renderer file editing for Changes');
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
assert.doesNotMatch(workspaceCards, /data-repository-details=|workspace-action-menu|>More</, 'project cards must not retain the redundant Project details or More actions');
assert.match(workspaceCards, /data-edit-workspace=/, 'project cards must keep Edit project as the single project-management action');
assert.match(workspaceCards, />Analytics</, 'project cards must keep Analytics directly available');
assert.doesNotMatch(workspaceCards, /data-run-validation=|>Run checks<|readinessFact\('Checks'/, 'project cards must not expose validation controls or a Checks readiness section');
assert.match(workspaceCards, /workspace-readiness compact good/, 'healthy project cards must avoid a second Ready-for-ChatGPT status block');
assert.doesNotMatch(workspaceActions, /data-run-validation|runValidationFromTrigger/, 'workspace action bindings must not retain the removed project-card checks action');
assert.match(workspaceCards, /const title = finding\.message \|\| humanizeFindingCode/, 'project health rows should lead with a user-facing problem description instead of an internal finding code');
assert.match(workspaceCards, /pillHtml\(findingSeverityLabel\(finding\.severity\), statusClass\(finding\.severity\)\)/, 'project health badges should use the same readable severity language as Troubleshooting');
assert.doesNotMatch(workspaceActions, /data-repository-details|openRepositoryDetails/, 'project actions must not retain a separate Project details modal path');
assert.doesNotMatch(read('src/ui/features/workspaces/details.js'), /workspaceDetailsHtml|workspace-details-body/, 'project details must not retain hidden card markup for a second modal');
for (const source of [workspaceFormSource, workspaceRepairSource]) {
  assert.doesNotMatch(source, />Workspace settings<|>Workspace name<|>Add workspace<|>Save workspace<|>Repair workspace path</, 'Project dialogs must not expose internal workspace terminology in primary controls');
}
assert.match(workspaceFormSource, />Project name</, 'project naming must use the same product vocabulary as the Projects page');
assert.match(workspaceFormSource, /title: isEdit \? 'Edit project' : 'Create project'/, 'project dialogs must use concise create/edit titles');
assert.match(workspaceFormSource, />Source folders</, 'project dialogs must present attached project roots as source folders');
assert.match(workspaceFormSource, />Project details</, 'Edit project must include the former project-details information in the same modal');
assert.match(workspaceFormSource, /workspaceOperationalHtml\(ws\)/, 'Edit project must render current operational project details');
assert.match(workspaceFormSource, />View tasks<.*>View activity</s, 'Edit project must retain the former project-details navigation links');
assert.match(workspaceFormSource, /data-add-source/, 'project dialogs must let users attach more than one source folder');
assert.match(workspaceFormSource, /sourcePaths,\s*enforceUniquePath: true/s, 'project dialogs must persist the complete source-folder list');
assert.match(workspaceFormSource, />Delete project from Rel\.AI</, 'project settings must make the destructive configuration-only action explicit');
assert.match(workspaceActions, /action: 'delete'.*confirmDelete: true/s, 'project deletion must use the explicit delete action and confirmation field');
assert.match(workspaceActions, /source folders and every file inside them will stay on your computer/i, 'project deletion must state that local source files remain untouched');
assert.match(workspaceRepairSource, /title: 'Repair project'/, 'project repair must use a concise product-facing modal title');
assert.match(workspaceRepairSource, />Replacement source folder</, 'project repair must describe the source-folder change rather than an internal workspace path');
const modalSource = read('src/ui/components/modal.js');
const confirmDialogSource = read('src/ui/components/confirm-dialog.js');
const interactionSafetySource = read('src/ui/interaction-safety.js');
assert.match(modalSource, /modal-close/, 'shared modals must own the visible close affordance');
assert.match(modalSource, /showModalConfirmation/, 'shared modals must preserve parent content while confirmations are open');
assert.match(confirmDialogSource, /hasOpenModal\(\).*showModalConfirmation/s, 'confirmations opened from a modal must stay inside the parent modal');
assert.doesNotMatch(interactionSafetySource, /window\.confirm/, 'Rel.AI interaction safety must not fall back to native browser confirmation dialogs');
assert.match(read('src/ui/command-palette.js'), /showClose: false/, 'Quick navigation remains the intentional close-button exception');
const connectorRefreshModalSource = read('src/ui/connector-refresh-modal.js');
assert.match(connectorRefreshModalSource, /createElement\('ol'\)/, 'connector refresh instructions must use an ordered list');
assert.match(connectorRefreshModalSource, /setDismissEnabled\(true\)/, 'connector refresh notices must unlock normal modal dismissal after the reading delay');
assert.match(read('src/ui/update-available-modal.js'), /actions\.appendChild\(later\)[\s\S]*actions\.appendChild\(primaryAction\)/, 'update dialogs must place Later before the primary update action');
assert.match(workspaceFormSource, /data-source-picker-wrap[\s\S]*isDesktop/, 'project forms must gate the native source-folder picker to the desktop surface');
assert.match(workspaceFormSource, /ws-source-manual-only/, 'browser project forms must keep the manual source-folder path as the single fallback control');
const connectorSource = read('src/ui/features/settings/connector.js');
const desktopConnectionSource = read('src/ui/features/settings/desktop-connection.js');
const settingsSharedSource = read('src/ui/features/settings/shared.js');
assert.match(connectorSource, /card connection-layer-disclosure connector-details|card connector-details connection-layer-disclosure/, 'Connection layers must share the aligned connector disclosure contract');
assert.match(connectorSource, /mountDesktopConnection\(controls,\{expanded:String\(state\.publicEndpoint\?\.status\|\|''\)===['"]disabled['"]\}\)/, 'connection credentials should open for initial setup and stay collapsed during normal use');
assert.match(desktopConnectionSource, /connection-settings-disclosure/, 'low-frequency connection credentials should use progressive disclosure');
assert.match(desktopConnectionSource, /Use a different OpenAI account or workspace/, 'Connection settings must expose account and workspace switching without adding a Rel.AI login');
assert.match(desktopConnectionSource, /update the existing Rel\.AI connector/, 'account switching must prefer updating an existing connector instead of creating duplicates');
assert.match(settingsSharedSource, /labelElement\.htmlFor = labelTarget\.id/, 'shared settings fields must associate visible labels with their controls');
assert.doesNotMatch(connectorSource, /connection-status-body[\s\S]{0,600}field-caption[^\n]*Tunnel ID/, 'primary connection status must not duplicate technical setup identifiers');
assert.match(connectorSource, /action\.href===['"]#diagnostics['"]/, 'connection recovery must not render a duplicate Troubleshooting link beside the primary recovery action');
assert.match(connectorSource, /data-restart-connection/, 'a retryable Secure MCP Tunnel failure must expose the desktop retry operation directly');
assert.match(connectorSource, /relai:desktop-status-refresh/, 'manual Connection refresh must apply authoritative Electron status before the aggregate dashboard refresh');
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
  assert.doesNotMatch(source, /#settings\/(?:diagnostics|tools-validation)/, `${relative} still targets a removed Settings route`);
}
assert.doesNotMatch(read('electron/main.js'), /options\.firstRun\s*\?\s*'#settings\/connection'/, 'first-run setup must continue on Overview instead of reopening completed Connection setup');

console.log('Frontend streamlining contracts passed.');


