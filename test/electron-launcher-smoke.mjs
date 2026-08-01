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
const { ensureManagedNgrok, extractPublicUrl, extractStartedTunnelUrl, writeNgrokConfig } = managedNgrokModule.default || managedNgrokModule;
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
assert.deepEqual(srcResource.filter, ['**/*.js'], 'electron build must package backend JavaScript without the source Tailwind stylesheet');
assert.equal(fs.existsSync(path.join(root, 'src', 'ui', 'colorTokens.mjs')), true, 'the build-time ESM color manifest must exist');
assert.equal(fs.existsSync(path.join(root, 'src', 'ui', 'colorTokens.js')), false, 'the removed CommonJS color manifest must not return');
assert.equal(srcResource.filter.includes('**/*.mjs'), false, 'the build-time color manifest must not be packaged as a runtime backend resource');
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
assert.ok(electronPkg.build.files.includes('ngrok-provenance.js'), 'electron build must include ngrok acquisition provenance verification');
assert.ok(electronPkg.build.files.includes('managed-ngrok.js'), 'electron build must include managed ngrok launcher code');
assert.equal(electronPkg.build.files.includes('installed-smoke.js'), false, 'electron build must not ship installed-app test hooks');
assert.equal(electronPkg.build.files.includes('window-smoke.js'), false, 'electron build must not ship renderer smoke entry points');
assert.equal(electronPkg.build.files.includes('smoke-evidence.js'), false, 'electron build must not ship release-evidence test support');
assert.ok(electronPkg.build.files.includes('tool-sleep-blocker.js'), 'electron build must include tool-call sleep prevention');
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
assert.ok(electronPkg.build.files.includes('desktop-lifecycle.js'), 'electron build must include desktop lifecycle state and startup ownership');
assert.ok(electronPkg.build.files.includes('controller-runtime.js'), 'electron build must include the active-controller runtime marker');
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
const ngrokResource = electronPkg.build.extraResources.find((item) => item.from === '../vendor/ngrok');
assert.ok(ngrokResource, 'electron build must package the ngrok acquisition manifest');
assert.deepEqual(ngrokResource.filter, ['manifest.json'], 'electron build must package only ngrok provenance, never ngrok.exe');

const electronMain = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
assert.doesNotMatch(electronMain, /--installed-smoke|--window-smoke|runInstalledSmoke|runWindowSmoke|smokeWindowRoles|getSmokeWindowRole/, 'production Electron main must not expose destructive smoke entry points');
const desktopTray = fs.readFileSync(path.join(root, 'electron', 'desktop-tray.js'), 'utf8');
const dashboardPreload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const dashboardPreloadSurface = dashboardPreload.split('} else {', 1)[0];
const desktopSettings = fs.readFileSync(path.join(root, 'electron', 'desktop-settings.js'), 'utf8');
const appUpdater = fs.readFileSync(path.join(root, 'electron', 'app-updater.js'), 'utf8');
const ipcHandlers = fs.readFileSync(path.join(root, 'electron', 'ipc-handlers.js'), 'utf8');
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
assert.match(electronMain, /removeControllerRuntimeMarker\(\)/, 'Electron must remove only its own runtime marker during clean shutdown');
assert.match(electronMain, /powerSaveBlocker/, 'Electron main must use the native sleep-prevention API');
assert.match(electronMain, /createTaskActivityRuntime/, 'Electron main must bind connector activity to sleep prevention, live status, and completion alerts');
assert.match(electronMain, /toolActivityRuntime\.stop\(\)/, 'tool activity runtime must stop during application shutdown');
assert.match(electronMain, /setNotificationsEnabled: toolActivityRuntime\.setNotificationsEnabled/, 'the desktop notification toggle must control task alerts');
assert.match(electronMain, /openDashboardWindow\('#settings'\)/, 'normal settings must deep-link the secured dashboard General settings route');
assert.match(dashboardPreload, /desktop:settings:get/, 'desktop settings must be read through constrained Electron IPC');
for (const channel of ['desktop:window:get-state', 'desktop:window:minimize', 'desktop:window:toggle-maximize', 'desktop:window:close']) {
  assert.match(dashboardPreload, new RegExp(channel.replaceAll(':', '\\:')), `${channel} must be exposed only through the constrained dashboard preload`);
  assert.match(ipcHandlers, new RegExp(channel.replaceAll(':', '\\:')), `${channel} must be registered through sender-scoped IPC`);
}
assert.match(dashboardPreload, /desktop:settings:save/, 'desktop settings must be saved through constrained Electron IPC');
assert.match(dashboardPreload, /desktop:approval-token:replace/, 'approval-token replacement must use its own constrained IPC action');
assert.match(electronMain, /onStatusChange: taskActivity => setStatus\(\{ taskActivity \}\)/, 'tool activity must be pushed into desktop surfaces');
assert.match(electronMain, /createApprovalTokenManager/, 'Electron main must delegate token rotation to the secured approval-token manager');
assert.match(electronMain, /onOAuthAuthorized: \(\) => setStatus\(\{ authenticationRequired: false/, 'successful ChatGPT approval must clear the desktop reapproval state');
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
assert.equal((electronMain.match(/desktopLifecycle\.markCleanShutdown\(\)/g) || []).length, 2, 'both before-quit and immediate tray exit must persist a clean lifecycle marker');
assert.match(desktopLifecycle, /setLoginItemSettings/);
assert.match(desktopLifecycle, /args: \['--background'\]/);
assert.match(desktopLifecycle, /recoveredAfterUncleanShutdown/);
assert.match(desktopLifecycle, /previousVersion/);
assert.match(desktopLifecycle, /desktop-lifecycle\.json/);
assert.match(dashboardPreload, /desktop:lifecycle:get/);
assert.match(dashboardPreload, /desktop:startup:set/);
assert.match(ipcHandlers, /desktop:lifecycle:get/);
assert.match(ipcHandlers, /desktop:startup:set/);
assert.match(electronMain, /function launchConfiguredDesktop\(/, 'desktop startup must have a dashboard-first lifecycle');
assert.match(electronMain, /function focusActiveWindow\(\)/, 'single-instance and notification focus must prefer the active application window');
assert.doesNotMatch(electronMain, /dashboardWindow\.hide\(\).*showFallbackRecovery/s, 'fallback recovery must never hide a healthy dashboard');
assert.match(electronMain, /recoveryWindowManager\.hide\(\)/, 'a successfully opened dashboard must dismiss the fallback window');
assert.doesNotMatch(electronMain, /settings\.html|options\.edit/, 'the removed compatibility settings renderer must not be reachable');
assert.match(electronMain, /getTaskActivity: toolActivityRuntime\.getStatus/, 'the web dashboard must receive the shared task model');
assert.match(electronMain, /getDesktopStatus: \(\) => currentStatus/, 'the dashboard payload must receive live Electron connection state');
assert.match(electronMain, /getRuntimeLogs: runtimeLogs\.snapshot/, 'the dashboard diagnostics endpoint must receive sanitized desktop logs');
assert.match(electronMain, /clearRuntimeLogs: runtimeLogs\.clear/, 'the dashboard must be able to clear only the runtime log buffer');
assert.match(electronMain, /createRecoveryWindowManager/, 'the fallback window must be isolated behind a dedicated manager');
assert.match(electronMain, /recoveryWindowManager\.show\(\)/, 'the fallback must remain available for dashboard or service startup failure');
assert.doesNotMatch(desktopTray, /Connection Recovery|showRecovery/, 'the tray must not expose the fallback as a routine destination');
assert.match(desktopTray, /Diagnostics/, 'the tray must route routine troubleshooting into dashboard Diagnostics');
assert.match(electronMain, /openDashboardWindow\('#settings\/diagnostics'\)/, 'tray Diagnostics must deep-link the dashboard');
assert.doesNotMatch(dashboardPreloadSurface, /openRecovery|desktop:open-recovery/, 'the routine dashboard bridge must not expose the fallback window');
assert.equal(fs.existsSync(path.join(root, 'electron', 'renderer', 'settings.html')), false);
assert.equal(fs.existsSync(path.join(root, 'electron', 'renderer', 'settings.js')), false);
assert.match(dashboardPreload, /exposeInMainWorld\('relaiDesktop'/, 'the dashboard preload must expose constrained desktop controls');
assert.match(electronMain, /dashboard\?surface=desktop/, 'the embedded dashboard must identify the desktop surface without a token query');
assert.match(electronMain, /options\.firstRun \? '#settings\/connection' : ''/, 'first-run desktop setup must hand off directly to Connection');
assert.match(fs.readFileSync(path.join(root, 'electron', 'ipc-handlers.js'), 'utf8'), /firstRun: config\?\.restart !== true/, 'recovery edits must not be treated as fresh first-run setup');
assert.doesNotMatch(electronMain, /shell\.openExternal\(`http:\/\/127\.0\.0\.1:.*dashboard/, 'Open Dashboard must not launch the system browser');

const ngrokTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-ngrok-test-'));
const ngrokTarget = path.join(ngrokTestDir, 'managed', 'ngrok.exe');
const verifiedBytes = 'verified-ngrok-release';
const testManifest = { version: '3.39.10' };
const testSpec = {
  archive: { url: 'https://bin.ngrok.com/test.zip', size: 7, sha256: 'a'.repeat(64) },
  executable: { file: 'ngrok.exe', size: verifiedBytes.length, sha256: 'b'.repeat(64) }
};
let downloadCount = 0;
const verifyExecutable = file => {
  assert.equal(fs.readFileSync(file, 'utf8'), verifiedBytes, 'only the expected verified ngrok bytes may be installed');
  return { sha256: testSpec.executable.sha256, bytes: verifiedBytes.length, version: testManifest.version };
};
const acquisition = {
  manifest: testManifest,
  spec: testSpec,
  targetPath: ngrokTarget,
  verifyExecutable,
  verifyArchive: () => ({ sha256: testSpec.archive.sha256, bytes: testSpec.archive.size }),
  downloadArchive: async (_url, archivePath) => {
    downloadCount += 1;
    fs.writeFileSync(archivePath, 'archive');
  },
  extractArchive: async (_archivePath, destination) => {
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, 'ngrok.exe'), verifiedBytes);
  }
};
await assert.rejects(() => ensureManagedNgrok(acquisition), /approve the official ngrok download/);
const firstAcquisition = await ensureManagedNgrok({ ...acquisition, allowDownload: true });
assert.equal(firstAcquisition.downloaded, true, 'first-run consent must acquire the official ngrok component');
assert.equal(downloadCount, 1);
const reused = await ensureManagedNgrok(acquisition);
assert.equal(reused.downloaded, false, 'a verified managed ngrok binary must be reused without network access');
assert.equal(downloadCount, 1);
fs.writeFileSync(ngrokTarget, 'tampered-ngrok');
const repaired = await ensureManagedNgrok({ ...acquisition, allowDownload: true });
assert.equal(repaired.repaired, true, 'an invalid managed ngrok binary must be replaced only after consent');
assert.equal(downloadCount, 2);
assert.equal(fs.readFileSync(ngrokTarget, 'utf8'), verifiedBytes);
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
