import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const utils = await import(pathToFileURL(path.join(root, 'electron', 'launcher-utils.js')).href);
const launcherConfigModule = await import(pathToFileURL(path.join(root, 'electron', 'launcher-config.js')).href);
const managedNgrokModule = await import(pathToFileURL(path.join(root, 'electron', 'managed-ngrok.js')).href);
const { saveLauncherConfig } = launcherConfigModule.default || launcherConfigModule;
const { extractPublicUrl, extractStartedTunnelUrl, synchronizeManagedBinary, writeNgrokConfig } = managedNgrokModule.default || managedNgrokModule;
const {
  buildTunnelCommand,
  buildMcpUrl,
  hasExistingConfig,
  normalizeNgrokDomain,
  normalizeNgrokAuthtoken,
  normalizePort,
  readGuiConfig
} = utils.default || utils;

assert.equal(normalizePort(3333), 3333);
assert.equal(normalizePort('4444'), 4444);
assert.throws(() => normalizePort(80), /between 1024 and 65535/);

assert.equal(normalizeNgrokDomain('https://My-Domain.ngrok-free.dev/'), 'my-domain.ngrok-free.dev');
assert.equal(normalizeNgrokAuthtoken('abc12345'), 'abc12345');
assert.throws(() => normalizeNgrokAuthtoken(''), /required/);
assert.throws(() => normalizeNgrokAuthtoken('abc 12345'), /spaces/);
assert.throws(() => normalizeNgrokDomain('example.com; rm -rf /'), /letters, numbers, dots, and hyphens|invalid/);
assert.throws(() => normalizeNgrokDomain('-bad.example.com'), /letters, numbers, dots, and hyphens|invalid DNS label/);
assert.equal(
  extractPublicUrl('Docs: https://ngrok.com/docs tunnel: https://my-domain.ngrok-free.dev', 'my-domain.ngrok-free.dev'),
  'https://my-domain.ngrok-free.dev',
  'managed ngrok must ignore unrelated HTTPS URLs and select the configured domain'
);
assert.equal(extractPublicUrl('https://wrong.ngrok-free.dev', 'my-domain.ngrok-free.dev'), '');
assert.equal(
  extractStartedTunnelUrl(
    "failed to start tunnel: The endpoint 'https://my-domain.ngrok-free.dev' is already online. ERR_NGROK_334",
    'my-domain.ngrok-free.dev'
  ),
  '',
  'an ngrok error that names the configured endpoint must not be treated as a published tunnel'
);
assert.equal(
  extractStartedTunnelUrl(
    'lvl=info msg="started tunnel" obj=tunnels url=https://my-domain.ngrok-free.dev',
    'my-domain.ngrok-free.dev'
  ),
  'https://my-domain.ngrok-free.dev',
  'managed ngrok must become ready only after its explicit started-tunnel event'
);

const tunnelCommand3333 = buildTunnelCommand('my-domain.ngrok-free.dev', 3333);
const tunnelCommand4444 = buildTunnelCommand('MY-DOMAIN.ngrok-free.dev', 4444);
assert.ok(tunnelCommand3333.includes('managed ngrok'));
assert.ok(tunnelCommand3333.includes('my-domain.ngrok-free.dev'));
assert.ok(tunnelCommand3333.includes('3333'));
assert.ok(tunnelCommand3333.includes('Rel.AI ngrok.yml'));
assert.ok(tunnelCommand4444.includes('my-domain.ngrok-free.dev'));
assert.ok(tunnelCommand4444.includes('4444'));

// Secret-in-URL is removed; ChatGPT uses Authentication: OAuth on the plain /mcp URL.
assert.equal(
  buildMcpUrl('https://my-domain.ngrok-free.dev'),
  'https://my-domain.ngrok-free.dev/mcp'
);
assert.equal(
  buildMcpUrl('https://my-domain.ngrok-free.dev/'),
  'https://my-domain.ngrok-free.dev/mcp'
);

const electronPkg = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'package.json'), 'utf8'));
const srcResource = electronPkg.build.extraResources.find((item) => item.from === '../src');
assert.ok(srcResource, 'electron build must bundle src resources');
assert.deepEqual(srcResource.filter, ['**/*.js'], 'electron build must package backend JavaScript without source Tailwind/build-only assets');
const binResource = electronPkg.build.extraResources.find((item) => item.from === '../bin');
assert.ok(binResource, 'electron build must bundle bin runtime resources');
assert.deepEqual(binResource.filter, ['**/*'], 'electron build must package the complete bin runtime tree');
const skillsResource = electronPkg.build.extraResources.find((item) => item.from === '../skills');
assert.ok(skillsResource, 'electron build must bundle the complete built-in skills tree');
assert.deepEqual(skillsResource.filter, ['**/*'], 'electron built-in skill packaging must include supporting files, not only SKILL.md');
const rootPackageForRuntime = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronRuntimeExclusions = new Set(['.codex-plugin', 'examples', 'types']);
const expectedElectronRuntimeDirectories = rootPackageForRuntime.files
  .filter(value => typeof value === 'string' && value.endsWith('/'))
  .map(value => value.replace(/\/$/, ''))
  .filter(value => !electronRuntimeExclusions.has(value));
const packagedResourceRoots = new Set(electronPkg.build.extraResources
  .map(item => String(item.from || '').replace(/^\.\.\//, '').replace(/\/$/, '')));
for (const directory of expectedElectronRuntimeDirectories) {
  assert.ok(packagedResourceRoots.has(directory), 'Electron packaging omitted root runtime directory: ' + directory);
}
assert.equal(fs.existsSync(path.join(root, 'src', 'ui', 'colorTokens.mjs')), true, 'the build-time ESM color manifest must exist');
assert.equal(fs.existsSync(path.join(root, 'src', 'ui', 'colorTokens.js')), false, 'the removed CommonJS color manifest must not return');
assert.equal(srcResource.filter.includes('**/*.mjs'), false, 'build-time ESM manifests must not be packaged as runtime backend resources');
for (const renderer of ['status.html', 'wizard.html']) {
  const html = fs.readFileSync(path.join(root, 'electron', 'renderer', renderer), 'utf8');
  assert.ok(html.indexOf('color-tokens.css') < html.indexOf('app.css'), `${renderer} must load canonical color tokens before component styles`);
}
const rootModulesResource = electronPkg.build.extraResources.find((item) => item.from === '../node_modules');
assert.ok(rootModulesResource, 'electron build must package root MCP SDK runtime dependencies');
for (const packagePath of ['@modelcontextprotocol/core/**', '@modelcontextprotocol/node/**', '@modelcontextprotocol/server/**', '@opentelemetry/**', '@hono/node-server/**', 'hono/**', 'zod/**']) {
  assert.ok(rootModulesResource.filter.includes(packagePath), `electron build must package ${packagePath}`);
}
assert.ok(rootModulesResource.filter.includes('!**/*.map'), 'packaged MCP SDK dependencies must exclude source maps');
for (const exclusion of ['!@modelcontextprotocol/*/src/**', '!@opentelemetry/*/src/**', '!@hono/*/src/**', '!hono/src/**', '!zod/src/**', '!**/test/**', '!**/tests/**', '!**/*.ts', '!**/*.cts', '!**/*.mts']) {
  assert.ok(rootModulesResource.filter.includes(exclusion), 'packaged MCP SDK dependencies must include ' + exclusion);
}
assert.ok(electronPkg.build.files.includes('ngrok-token.js'), 'electron build must include ngrok authtoken normalization used by launcher code');
assert.ok(electronPkg.build.files.includes('managed-ngrok.js'), 'electron build must include managed ngrok launcher code');
assert.equal(electronPkg.build.files.includes('installed-smoke.js'), false, 'electron build must not ship installed-app test hooks');
assert.equal(electronPkg.build.files.includes('window-smoke.js'), false, 'electron build must not ship renderer smoke entry points');
assert.equal(electronPkg.build.files.includes('smoke-evidence.js'), false, 'electron build must not ship release-evidence test support');
assert.ok(electronPkg.build.files.includes('tool-sleep-blocker.js'), 'electron build must include tool-call sleep prevention');
assert.ok(electronPkg.build.files.includes('taskbar-completion-badge.js'), 'electron build must include the Windows taskbar completion indicator');
assert.ok(electronPkg.build.files.includes('dashboard-window.js'), 'electron build must include the secured dashboard host');
assert.ok(electronPkg.build.files.includes('dashboard-window-bounds.js'), 'electron build must include bounded dashboard window-state handling');
assert.ok(electronPkg.build.files.includes('window-chrome.js'), 'electron build must include platform-specific dashboard window chrome policy');
assert.ok(electronPkg.build.files.includes('preload.cjs'), 'electron build must include the desktop dashboard bridge');
assert.ok(electronPkg.build.files.includes('desktop-tray.js'), 'electron build must include the desktop tray controller');
assert.ok(electronPkg.build.files.includes('desktop-status.js'), 'electron build must include the normalized desktop status model');
assert.ok(electronPkg.build.files.includes('approval-token.js'), 'electron build must include the secured approval-token manager');
assert.ok(electronPkg.build.files.includes('recovery-window.js'), 'electron build must include the failure-only recovery window manager');
assert.ok(electronPkg.build.files.includes('runtime-log-buffer.js'), 'electron build must include the sanitized runtime log buffer');
assert.ok(electronPkg.build.files.includes('app-updater.js'), 'electron build must include the application updater');
assert.ok(electronPkg.build.files.includes('app-updater-state.js'), 'electron build must include updater state persistence');
assert.ok(electronPkg.build.files.includes('desktop-settings.js'), 'electron build must include extracted desktop settings ownership');
assert.ok(electronPkg.build.files.includes('desktop-notifications.js'), 'electron build must include centralized desktop notification ownership');
assert.ok(electronPkg.build.files.includes('desktop-lifecycle.js'), 'electron build must include desktop lifecycle state and startup ownership');
assert.ok(electronPkg.build.files.includes('shutdown-coordinator.js'), 'electron build must include coordinated shutdown ownership');
assert.ok(electronPkg.build.files.includes('controller-runtime.js'), 'electron build must include the active-controller runtime marker');
assert.ok(electronPkg.build.files.includes('public-connection-runtime.js'), 'electron build must include cloud/direct public connection lifecycle ownership');
assert.ok(electronPkg.build.files.includes('gateway-actions.js'), 'electron build must include gateway account and device action ownership');
assert.ok(electronPkg.build.files.includes('service-runtime.js'), 'electron build must include local service and public connection startup ownership');
assert.ok(electronPkg.build.files.includes('setup-window.js'), 'electron build must include setup window lifecycle ownership');
for (const relayFile of ['cloud-relay-state.js', 'cloud-relay-client.js', 'cloud-relay-runtime.js']) {
  assert.equal(electronPkg.build.files.includes(relayFile), false, `electron build must not include removed relay module ${relayFile}`);
}
assert.ok(electronPkg.build.files.includes('window-security.js'), 'electron build must include local renderer isolation policy');
assert.ok(electronPkg.build.files.includes('local-protocol.js'), 'electron build must include the restricted local renderer protocol');
assert.ok(electronPkg.build.files.includes('ipc-security.js'), 'electron build must include IPC sender policy');
assert.ok(electronPkg.build.files.includes('app-updater-events.js'), 'electron build must include fail-closed updater event handling');
assert.ok(electronPkg.build.files.includes('update-version.js'), 'electron build must include monotonic update version checks');
assert.equal(electronPkg.dependencies['electron-updater'], '6.8.9');
assert.equal(electronPkg.devDependencies['@electron/fuses'], '2.1.3');
assert.equal(electronPkg.build.afterPack, 'build/after-pack.js');
assert.equal(electronPkg.build.publish[0].provider, 'github');
assert.equal(electronPkg.build.publish[0].repo, 'rel-ai-mcp');
const windowsNgrokResource = electronPkg.build.win.extraResources.find((item) => item.from === '../vendor/ngrok');
const linuxNgrokResource = electronPkg.build.linux.extraResources.find((item) => item.from === '../vendor/ngrok');
assert.ok(windowsNgrokResource, 'Windows packaging must bundle the ngrok seed binary');
assert.ok(linuxNgrokResource, 'Linux packaging must bundle the ngrok seed binary');
assert.deepEqual(windowsNgrokResource.filter, ['manifest.json', 'win32/**'], 'Windows packaging must bundle only the Windows ngrok seed');
assert.deepEqual(linuxNgrokResource.filter, ['manifest.json', 'linux/**'], 'Linux packaging must bundle only the Linux ngrok seed');
assert.deepEqual(electronPkg.build.linux.target, ['AppImage', 'deb']);
assert.equal(electronPkg.build.linux.maintainer, 'Kyne <Kyne0328@users.noreply.github.com>');
assert.equal(electronPkg.build.linux.executableName, 'rel-ai-mcp');
assert.equal(electronPkg.build.appImage.artifactName, 'Rel.AI-MCP-${version}-linux-x64.${ext}');
assert.equal(electronPkg.build.deb.artifactName, 'Rel.AI-MCP-${version}-linux-x64.${ext}');

const electronMain = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const toolSleepBlocker = fs.readFileSync(path.join(root, 'electron', 'tool-sleep-blocker.js'), 'utf8');
const taskbarCompletionBadge = fs.readFileSync(path.join(root, 'electron', 'taskbar-completion-badge.js'), 'utf8');
assert.doesNotMatch(electronMain, /--installed-smoke|--window-smoke|runInstalledSmoke|runWindowSmoke|smokeWindowRoles|getSmokeWindowRole/, 'production Electron main must not expose destructive smoke entry points');
const desktopTray = fs.readFileSync(path.join(root, 'electron', 'desktop-tray.js'), 'utf8');
const dashboardPreload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const dashboardPreloadSurface = dashboardPreload.split('} else {', 1)[0];
const desktopSettings = fs.readFileSync(path.join(root, 'electron', 'desktop-settings.js'), 'utf8');
const appUpdater = fs.readFileSync(path.join(root, 'electron', 'app-updater.js'), 'utf8');
const serviceRuntime = fs.readFileSync(path.join(root, 'electron', 'service-runtime.js'), 'utf8');
const ipcHandlers = fs.readFileSync(path.join(root, 'electron', 'ipc-handlers.js'), 'utf8');
const dashboardIpcHandlers = fs.readFileSync(path.join(root, 'electron', 'ipc-handlers-dashboard.js'), 'utf8');
const ipcSecurity = fs.readFileSync(path.join(root, 'electron', 'ipc-security.js'), 'utf8');
const windowSecurity = fs.readFileSync(path.join(root, 'electron', 'window-security.js'), 'utf8');
const appUpdaterEvents = fs.readFileSync(path.join(root, 'electron', 'app-updater-events.js'), 'utf8');
const desktopLifecycle = fs.readFileSync(path.join(root, 'electron', 'desktop-lifecycle.js'), 'utf8');
const dashboardManagerInit = electronMain.indexOf('const dashboardWindowManager =');
const desktopTrayInit = electronMain.indexOf('const desktopTray =');
const taskActivityRuntimeInit = electronMain.indexOf('const toolActivityRuntime =');
assert.ok(dashboardManagerInit >= 0 && dashboardManagerInit < taskActivityRuntimeInit, 'dashboard manager must exist before the eager task-status callback runs');
assert.ok(desktopTrayInit >= 0 && desktopTrayInit < taskActivityRuntimeInit, 'desktop tray must exist before the eager task-status callback runs');
assert.match(
  electronMain,
  /import \{ fitWindowToContent, WINDOW_SIZE_LIMITS \} from '\.\/window-size\.js';/,
  'Electron main must import the window limits used by normal wizard and status startup'
);
assert.match(electronMain, /app\.setName\('Rel\.AI MCP'\)/, 'Electron must expose the product name instead of the generic Electron app name');
assert.match(electronMain, /app\.setAppUserModelId\('com\.relai\.mcp'\)/, 'Windows notifications must use the packaged Rel.AI application identity');
assert.match(electronMain, /writeControllerRuntimeMarker\(app\)/, 'Electron must publish its runtime paths before starting the controller');
assert.match(electronMain, /removeRuntimeMarker: removeControllerRuntimeMarker/, 'Electron must remove only its own runtime marker through coordinated shutdown');
assert.match(electronMain, /powerSaveBlocker/, 'Electron main must use the native sleep-prevention API');
assert.match(toolSleepBlocker, /prevent-display-sleep/, 'active work sessions must prevent the computer and display from sleeping');
assert.doesNotMatch(toolSleepBlocker, /prevent-app-suspension/, 'app-only suspension blocking is insufficient for keeping the computer awake');
assert.match(electronMain, /createTaskActivityRuntime/, 'Electron main must bind connector activity to sleep prevention, live status, and completion alerts');
assert.match(electronMain, /createTaskbarCompletionBadge/, 'Electron main must create the completion taskbar indicator');
assert.match(electronMain, /createTaskbarCompletionBadge\(\{\s*app,\s*nativeImage/s, 'Electron main must provide the app badge API for Linux and macOS launchers');
assert.match(electronMain, /onTaskCompleted: task => taskbarCompletionBadge\.markCompleted\(task\)/, 'explicit completion must increment the taskbar indicator');
assert.match(electronMain, /browser-window-focus.*taskbarCompletionBadge\.clear/s, 'opening or focusing the app must clear the taskbar indicator');
assert.match(taskbarCompletionBadge, /setOverlayIcon/, 'Windows completion count must use the taskbar overlay API');
assert.match(taskbarCompletionBadge, /setBadgeCount/, 'Linux and macOS completion counts must use the application badge API');
assert.match(taskbarCompletionBadge, /createFromBuffer/, 'Windows overlays must use a decodable PNG buffer');
assert.doesNotMatch(taskbarCompletionBadge, /createFromDataURL/, 'Windows overlays must not rely on unsupported SVG data URLs');
assert.match(taskbarCompletionBadge, /seenTaskIds/, 'duplicate completion events must not increment the taskbar indicator');
assert.match(electronMain, /toolActivityRuntime\.stop\(\)/, 'tool activity runtime must stop during application shutdown');
assert.match(electronMain, /setNotificationsEnabled: desktopNotifications\.setEnabled/, 'the legacy desktop notification toggle must control the centralized master preference');
assert.match(electronMain, /notify: desktopNotifications\.show/, 'task alerts must use the centralized category-aware notification service');
assert.match(electronMain, /openDashboardWindow\('#settings'\)/, 'normal settings must deep-link the secured dashboard General settings route');
assert.match(dashboardPreload, /desktop:settings:get/, 'desktop settings must be read through constrained Electron IPC');
for (const channel of ['desktop:window:get-state', 'desktop:window:minimize', 'desktop:window:toggle-maximize', 'desktop:window:close']) {
  assert.match(dashboardPreload, new RegExp(channel.replaceAll(':', '\\:')), `${channel} must be exposed only through the constrained dashboard preload`);
  assert.match(ipcHandlers, new RegExp(channel.replaceAll(':', '\\:')), `${channel} must be registered through sender-scoped IPC`);
}
assert.match(dashboardPreload, /desktop:settings:save/, 'desktop settings must be saved through constrained Electron IPC');
assert.match(dashboardPreload, /desktop:approval-token:replace/, 'approval-token replacement must use its own constrained IPC action');
assert.doesNotMatch(dashboardPreload, /desktop:cloud:/, 'removed cloud relay IPC must not be exposed');
assert.doesNotMatch(electronMain, /CloudRelay|cloudRelay|REL_AI_CLOUD/, 'Electron main must use only the managed ngrok connection path');
assert.match(electronMain, /onStatusChange: taskActivity => setStatus\(\{ taskActivity \}\)/, 'tool activity must be pushed into desktop surfaces');
assert.match(electronMain, /createApprovalTokenManager/, 'Electron main must delegate token rotation to the secured approval-token manager');
assert.match(electronMain, /createPublicConnectionRuntime/, 'Electron main must delegate cloud/direct public connection lifecycle to one runtime owner');
assert.match(electronMain, /createGatewayClient/, 'cloud mode must use the authenticated gateway client');
assert.doesNotMatch(electronMain, /tunnelProcess/, 'Electron main must not retain a second ngrok process owner outside the public connection runtime');
assert.match(serviceRuntime, /onOAuthAuthorized: \(\) => \{[\s\S]*guiConfig\.connectionMode === 'direct'[\s\S]*setStatus\(\{ authenticationRequired: false/, 'local OAuth approval must clear reapproval only for Direct mode');
assert.match(desktopSettings, /token: current\.token/, 'ordinary desktop settings saves must preserve the current approval token');
assert.doesNotMatch(desktopSettings, /token: settings\.approvalToken/, 'ordinary desktop settings saves must not rotate the approval token');
assert.match(electronMain, /createDashboardWindowManager/, 'Electron must host the dashboard in a dedicated window');
assert.match(electronMain, /desktopTray\.setup\(\)/, 'the tray must exist independently of the recovery window');
assert.match(electronMain, /createAppUpdater/, 'Electron main must own one application updater runtime');
assert.match(electronMain, /appUpdater\.start\(\)/, 'the updater must start after Electron is ready');
assert.match(electronMain, /appUpdater\?\.stop\(\)/, 'the updater must stop during application shutdown');
assert.match(appUpdater, /autoDownload = false/, 'updates must not download without user approval');
assert.match(appUpdater, /autoInstallOnAppQuit = false/, 'updates must not install on an unrelated app exit');
assert.match(appUpdater, /active Rel\.AI tool call/, 'update installation must not interrupt active Rel.AI work');
assert.match(dashboardPreload, /desktop:update:get/);
assert.match(dashboardPreload, /desktop:update:check/);
assert.match(dashboardPreload, /desktop:update:download/);
assert.match(dashboardPreload, /desktop:update:install/);
assert.match(dashboardPreload, /desktop:update-status/);
assert.match(ipcHandlers, /getDashboardWindow/);
assert.match(ipcHandlers, /createWindowGuards/);
assert.match(ipcHandlers, /Secured dashboard controls/);
assert.match(ipcSecurity, /BrowserWindow\.fromWebContents/);
assert.match(ipcSecurity, /dashboard\.ngrok\.com/);
assert.match(windowSecurity, /sandbox: true/);
assert.match(windowSecurity, /will-download/);
assert.match(appUpdaterEvents, /does not match expected version/);
assert.match(desktopTray, /Check for Updates/);
assert.match(desktopTray, /Download update/);
assert.match(desktopTray, /Restart to install/);
assert.match(electronMain, /launchConfiguredDesktop\(\{ background: lifecycleStatus\.openedAtLogin \}\)/, 'configured sign-in launches must preserve the background-startup decision');
assert.match(electronMain, /if \(!options\.background\) await showDashboardWindow/, 'normal launches must open the dashboard while background launches remain tray-only');
assert.match(electronMain, /createShutdownCoordinator/, 'Electron must coordinate service, process, telemetry, and lifecycle shutdown');
assert.match(electronMain, /closeWindows\(\) \{[\s\S]*dashboardWindowManager\.close\(\);[\s\S]*recoveryWindowManager\.close\(\);[\s\S]*setupWindowManager\.close\(\{ returnToFallback: false \}\);/, 'Electron must compose desktop window cleanup at the application root');
assert.match(electronMain, /event\.preventDefault\(\)/, 'Electron must delay before-quit until owned runtime cleanup finishes');
assert.match(electronMain, /await shutdownCoordinator\.prepare\('quit'\)/, 'tray quit must await the same shutdown coordinator');
assert.match(desktopLifecycle, /setLoginItemSettings/);
assert.match(desktopLifecycle, /args: \['--background'\]/);
assert.match(desktopLifecycle, /recoveredAfterUncleanShutdown/);
assert.match(desktopLifecycle, /previousVersion/);
assert.match(desktopLifecycle, /desktop-lifecycle\.json/);
assert.match(dashboardPreload, /desktop:lifecycle:get/);
assert.match(dashboardPreload, /desktop:startup:set/);
assert.match(dashboardIpcHandlers, /desktop:lifecycle:get/);
assert.match(dashboardIpcHandlers, /desktop:startup:set/);
assert.match(electronMain, /function launchConfiguredDesktop\(/, 'desktop startup must have a dashboard-first lifecycle');
assert.match(serviceRuntime, /const pendingStart = start\(runToken\);[\s\S]*startPromise = pendingStart;[\s\S]*startPromise === pendingStart/, 'startup promise cleanup must be identity-safe across overlapping restart generations');
assert.doesNotMatch(serviceRuntime, /if \(runToken !== lifecycleToken\) \{\s*await publicConnectionRuntime\.stop/, 'a stale startup completion must not stop the current public connection generation');
assert.match(electronMain, /function focusActiveWindow\(\)/, 'single-instance and notification focus must prefer the active application window');
assert.doesNotMatch(electronMain, /dashboardWindow\.hide\(\).*showFallbackRecovery/s, 'fallback recovery must never hide a healthy dashboard');
assert.match(electronMain, /recoveryWindowManager\.hide\(\)/, 'a successfully opened dashboard must dismiss the fallback window');
assert.doesNotMatch(electronMain, /settings\.html|options\.edit/, 'the removed compatibility settings renderer must not be reachable');
assert.match(serviceRuntime, /getTaskActivity: toolActivityRuntime\.getStatus/, 'the web dashboard must receive the shared task model');
assert.match(serviceRuntime, /getDesktopStatus: getCurrentStatus/, 'the dashboard payload must receive live Electron connection state');
assert.match(serviceRuntime, /getRuntimeLogs: runtimeLogs\.snapshot/, 'the dashboard diagnostics endpoint must receive sanitized desktop logs');
assert.match(serviceRuntime, /clearRuntimeLogs: runtimeLogs\.clear/, 'the dashboard must be able to clear only the runtime log buffer');
assert.match(electronMain, /createRecoveryWindowManager/, 'the fallback window must be isolated behind a dedicated manager');
assert.match(electronMain, /recoveryWindowManager\.show\(\)/, 'the fallback must remain available for dashboard or service startup failure');
assert.doesNotMatch(desktopTray, /Connection Recovery|showRecovery/, 'the tray must not expose the fallback as a routine destination');
assert.match(desktopTray, /Diagnostics/, 'the tray must route routine troubleshooting into dashboard Diagnostics');
assert.match(electronMain, /openDashboardWindow\('#diagnostics'\)/, 'tray Diagnostics must deep-link the dashboard');
assert.doesNotMatch(dashboardPreloadSurface, /openRecovery|desktop:open-recovery/, 'the routine dashboard bridge must not expose the fallback window');
assert.equal(fs.existsSync(path.join(root, 'electron', 'renderer', 'settings.html')), false);
assert.equal(fs.existsSync(path.join(root, 'electron', 'renderer', 'settings.js')), false);
assert.match(dashboardPreload, /exposeInMainWorld\('relaiDesktop'/, 'the dashboard preload must expose constrained desktop controls');
assert.match(serviceRuntime, /dashboard\?surface=desktop/, 'the embedded dashboard must identify the desktop surface without a token query');
assert.match(electronMain, /showDashboardWindow\(''\)/, 'first-run desktop setup must hand off to dashboard Home so Getting started can continue onboarding');
assert.match(fs.readFileSync(path.join(root, 'electron', 'ipc-handlers.js'), 'utf8'), /firstRun: config\?\.restart !== true/, 'recovery edits must not be treated as fresh first-run setup');
assert.doesNotMatch(electronMain, /shell\.openExternal\(`http:\/\/127\.0\.0\.1:.*dashboard/, 'Open Dashboard must not launch the system browser');

const ngrokTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-ngrok-test-'));
const ngrokSource = path.join(ngrokTestDir, 'source.exe');
const ngrokTarget = path.join(ngrokTestDir, 'managed', 'ngrok.exe');
fs.writeFileSync(ngrokSource, 'verified-ngrok-release');
const firstSync = synchronizeManagedBinary(ngrokSource, ngrokTarget);
assert.equal(firstSync.copied, true, 'managed ngrok must be seeded from the bundled release binary');
assert.equal(fs.readFileSync(ngrokTarget, 'utf8'), 'verified-ngrok-release');
const secondSync = synchronizeManagedBinary(ngrokSource, ngrokTarget);
assert.equal(secondSync.copied, false, 'matching managed ngrok must not be rewritten');
fs.writeFileSync(ngrokTarget, 'stale-self-updated-ngrok');
const repairedSync = synchronizeManagedBinary(ngrokSource, ngrokTarget);
assert.equal(repairedSync.copied, true, 'a changed managed ngrok binary must be restored from the signed Rel.AI release');
assert.equal(fs.readFileSync(ngrokTarget, 'utf8'), 'verified-ngrok-release');
process.env.REL_AI_MCP_STATE_DIR = path.join(ngrokTestDir, 'state');
const managedConfig = fs.readFileSync(writeNgrokConfig('abc12345'), 'utf8');
assert.match(managedConfig, /update_check: false/, 'managed ngrok must not self-update outside the Rel.AI release process');
assert.match(managedConfig, /remote_management: false/, 'managed ngrok remote management must remain disabled');
fs.rmSync(ngrokTestDir, { recursive: true, force: true });

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-gui-test-'));
process.env.REL_AI_MCP_STATE_DIR = stateDir;

assert.equal(hasExistingConfig(), false);

fs.writeFileSync(path.join(stateDir, 'connection.json'), JSON.stringify({ port: 3333 }));
assert.equal(hasExistingConfig(), false);

fs.writeFileSync(
  path.join(stateDir, '.env'),
  'REL_AI_MCP_NGROK_DOMAIN="my-domain.ngrok-free.dev"\nREL_AI_MCP_NGROK_AUTHTOKEN="abc12345"\nREL_AI_MCP_TOKEN="token"\n'
);
assert.equal(hasExistingConfig(), true);
assert.deepEqual(
  { port: readGuiConfig().port, ngrokDomain: readGuiConfig().ngrokDomain, ngrokAuthtoken: readGuiConfig().ngrokAuthtoken, token: readGuiConfig().token },
  { port: 3333, ngrokDomain: 'my-domain.ngrok-free.dev', ngrokAuthtoken: 'abc12345', token: 'token' }
);

fs.writeFileSync(path.join(stateDir, 'connection.json'), JSON.stringify({}));
assert.equal(hasExistingConfig(), false);

const freshStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-gui-config-init-'));
const freshConfigPath = path.join(freshStateDir, 'config.json');
process.env.REL_AI_MCP_STATE_DIR = freshStateDir;
process.env.REL_AI_MCP_CONFIG = freshConfigPath;
saveLauncherConfig({
  port: 3333,
  ngrokDomain: 'portable-domain.ngrok-free.dev',
  ngrokAuthtoken: 'abc12345',
  token: 'dashboard-token'
});
assert.equal(fs.existsSync(freshConfigPath), true, 'desktop setup must create the core config automatically');
const createdConfig = JSON.parse(fs.readFileSync(freshConfigPath, 'utf8'));
assert.deepEqual(createdConfig.workspaces, {}, 'skipped onboarding must start with an empty valid workspace map');

createdConfig.workspaces.keep = { path: freshStateDir };
fs.writeFileSync(freshConfigPath, `${JSON.stringify(createdConfig, null, 2)}\n`);
saveLauncherConfig({
  port: 3333,
  ngrokDomain: 'portable-domain.ngrok-free.dev',
  ngrokAuthtoken: 'abc12345',
  token: 'dashboard-token'
});
const preservedConfig = JSON.parse(fs.readFileSync(freshConfigPath, 'utf8'));
assert.equal(preservedConfig.workspaces.keep.path, freshStateDir, 'desktop setup must not overwrite an existing config');

fs.rmSync(stateDir, { recursive: true, force: true });
fs.rmSync(freshStateDir, { recursive: true, force: true });

console.log('electron-launcher-smoke passed.');
