import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const dashboardTokens = `${read('src/ui/styles/color-tokens.css')}\n${read('src/ui/styles/app.css')}`;
const electronCss = `${read('electron/renderer/color-tokens.css')}\n${read('electron/renderer/app.css')}`;
const wizardHtml = read('electron/renderer/wizard.html');
const wizardJs = read('electron/renderer/wizard.js');
const statusHtml = read('electron/renderer/status.html');
const statusJs = read('electron/renderer/status.js');
const preload = read('electron/preload.cjs');
const ipc = `${read('electron/ipc-handlers.js')}\n${read('electron/ipc-handlers-dashboard.js')}`;
const ipcSecurity = read('electron/ipc-security.js');
const windowSecurity = read('electron/window-security.js');
const main = read('electron/main.js');
const desktopSettings = read('electron/desktop-settings.js');
const desktopConnection = read('src/ui/features/settings/desktop-connection.js');
const appUpdater = read('electron/app-updater.js');
const appUpdaterEvents = read('electron/app-updater-events.js');
const desktopLifecycle = read('electron/desktop-lifecycle.js');
const dashboardJs = read('public/dashboard.js');
const dashboardServer = `${read('src/http/dashboard.js')}\n${read('src/http/dashboardShellChrome.js')}`;
const windowChromePolicy = read('electron/window-chrome.js');
const dashboardWindowPolicy = read('electron/dashboard-window.js');
const windowChromeUi = read('src/ui/window-chrome.js');
const electronPackage = JSON.parse(read('electron/package.json'));

function tokenValue(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const match = source.match(new RegExp(String.raw`${escaped}\s*:\s*([^;]+);`));
  assert.ok(match, `Missing token ${name}`);
  return match[1].trim().replace(/\s+/g, ' ');
}

for (const name of ['--ui-canvas','--ui-surface-primary','--ui-surface-secondary','--ui-surface-raised','--ui-text-primary','--ui-text-secondary','--ui-text-tertiary','--ui-action-primary','--ui-status-success-foreground','--ui-status-warning-foreground','--ui-status-danger-foreground','--scrollbar-size','--scrollbar-size-compact','--ui-scrollbar-track','--ui-scrollbar-thumb','--ui-scrollbar-thumb-hover','--ui-scrollbar-thumb-active','--ui-scrollbar-corner']) {
  assert.equal(tokenValue(electronCss, name), tokenValue(dashboardTokens, name), `${name} must match between Electron and dashboard themes`);
}

for (const file of ['electron/renderer/status.html', 'electron/renderer/wizard.html']) {
  const html = read(file);
  assert.match(html, /<link\s+rel="stylesheet"\s+href="\.\/color-tokens\.css"\s*\/?\s*>|<link\s+rel="stylesheet"\s+href="color-tokens\.css"\s*\/?\s*>/);
  assert.match(html, /<link\s+rel="stylesheet"\s+href="\.\/app\.css"\s*\/?\s*>|<link\s+rel="stylesheet"\s+href="app\.css"\s*\/?\s*>/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /relai-logo\.png[^>]*width="193"[^>]*height="187"/);
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /Open in browser/i);
}
assert.doesNotMatch(wizardHtml, /<div class="wizard-logo">R<\/div>/, 'setup wizard must not restore the synthetic R badge');
assert.match(wizardHtml, /<small>\/ MCP<\/small>/, 'setup wizard branding should match the website wordmark treatment');

assert.match(wizardHtml, /OpenAI Secure MCP Tunnel/);
assert.match(wizardHtml, /id="tunnelIdInput"/);
assert.match(wizardHtml, /id="tunnelApiKeyInput"/);
assert.match(wizardHtml, /id="portInput"/);
assert.match(wizardHtml, /id="connectBtn"/);
assert.match(wizardHtml, /Open OpenAI Tunnels/i);
assert.match(wizardHtml, /Open OpenAI API Keys/i);
assert.match(wizardHtml, /same OpenAI organization as your tunnel/i);
assert.match(wizardHtml, /restricted API key/i);
assert.match(wizardHtml, /encrypted by your operating system/i);
assert.doesNotMatch(wizardHtml, /ngrok|Cloudflare|Rel\.AI Cloud|approval token|pairing code|Direct connection/i);
assert.match(wizardJs, /validTunnelId/);
assert.match(wizardJs, /wizardDone\(\{ tunnelId, tunnelApiKey, port, restart: recoveryMode \}\)/);
assert.match(wizardJs, /getRecoveryConfig/);
assert.match(wizardJs, /openOpenAISetup\(destination\)/);
assert.doesNotMatch(wizardJs, /ngrok|gateway|approvalToken|connectionMode/i);

assert.match(statusHtml, /Backup connection window/);
assert.match(statusHtml, /Secure MCP Tunnel/);
assert.match(statusHtml, /Copy tunnel ID/);
assert.match(statusHtml, /id="localHealthCard"/);
assert.match(statusHtml, /id="publicHealthCard"/);
assert.match(statusHtml, /id="serverToggleBtn"/);
assert.match(statusHtml, /id="notificationToggleBtn"/);
assert.match(statusHtml, /Recent app logs/);
assert.match(statusJs, /currentStatus\.tunnelId/);
assert.match(statusJs, /Tunnel ID copied/);
assert.match(statusJs, /The Secure MCP Tunnel did not become ready/);
assert.match(statusJs, /Secure tunnel:/);
assert.match(statusJs, /Local MCP:/);
assert.match(statusJs, /safeDiagnosticText/);
assert.match(statusJs, /Task activity:/);
assert.doesNotMatch(statusJs, /currentStatus\.mcpUrl|approval token|ngrok|gateway/i);

for (const channel of ['desktop:settings:get','desktop:settings:save','desktop:analytics:local','desktop:update:get','desktop:update:check','desktop:update:download','desktop:update:install','desktop:lifecycle:get','desktop:startup:set','desktop:notifications:get','desktop:notifications:set','desktop:notification-preferences:get','desktop:notification-preferences:set','desktop:diagnostics:export','desktop:diagnostics:open-folder','desktop:window:get-state','desktop:window:minimize','desktop:window:toggle-maximize','desktop:window:close']) {
  assert.match(preload, new RegExp(channel.replaceAll(':', '\\:')));
  assert.match(ipc, new RegExp(channel.replaceAll(':', '\\:')));
}
assert.match(preload, /getLocalUsage/);
assert.match(preload, /getRecoveryConfig/);
assert.match(preload, /openRecoverySetup/);
assert.match(preload, /return \(\) => ipcRenderer\.removeListener\(channel, listener\)/);
assert.doesNotMatch(preload, /removeAllListeners/);
assert.doesNotMatch(preload, /gateway|approvalToken|openExternal|open-link/i);
assert.doesNotMatch(ipc, /desktop:gateway|desktop:approval|wizard:cloud|url:open-link/i);
assert.match(ipc, /setTunnelApiKey/);
assert.match(ipc, /saveLauncherConfig/);
assert.match(ipc, /createWindowGuards/);
assert.match(ipcSecurity, /BrowserWindow\.fromWebContents/);
assert.doesNotMatch(ipcSecurity, /ngrok|gateway/i);

assert.match(desktopSettings, /tunnelApiKey: ''/);
assert.match(desktopSettings, /tunnelApiKeyConfigured/);
assert.match(desktopSettings, /replacementApiKey/);
assert.match(desktopSettings, /setTunnelApiKey/);
assert.doesNotMatch(desktopSettings, /ngrok|gateway|approval/i);
assert.match(desktopConnection, /OpenAI Secure MCP Tunnel/);
assert.match(desktopConnection, /Runtime API key/);
assert.match(desktopConnection, /saved key for this Secure MCP Tunnel is encrypted on this computer and is never shown again/i);
assert.match(desktopConnection, /Save and restart connection/);
assert.doesNotMatch(desktopConnection, /ngrok|gateway|pairing|approval token/i);

for (const file of ['secure-tunnel-runtime.js','tunnel-credentials.js','service-runtime.js','desktop-settings.js']) assert.ok(electronPackage.build.files.includes(file));
for (const removed of ['managed-ngrok.js','ngrok-token.js','public-connection-runtime.js','gateway-client.js','gateway-actions.js','gateway-device-identity.js','approval-token.js']) assert.equal(electronPackage.build.files.includes(removed), false);
assert.ok(electronPackage.build.win.extraResources.some(item => item.from === '../vendor/tunnel-client' && item.to === 'bin/tunnel-client'));
assert.equal(electronPackage.build.win.extraResources.some(item => /ngrok|gateway/i.test(String(item.from || ''))), false);

assert.match(main, /createSecureTunnelRuntime/);
assert.match(main, /createTunnelCredentialStore/);
assert.match(main, /openDashboardWindow\('#settings'\)/);
assert.match(main, /openDashboardWindow\('#diagnostics'\)/);
assert.match(main, /waitForLocalService\(startServer\(\)\)/, 'foreground dashboard opening must stop waiting once the local service is ready');
assert.match(main, /options\.background \? await pendingStart : await waitForLocalService\(pendingStart\)/, 'foreground configured startup must show the dashboard while the tunnel continues connecting');
assert.doesNotMatch(main, /createGatewayClient|createPublicConnectionRuntime|createApprovalTokenManager|managedNgrok/);
assert.match(windowSecurity, /contextIsolation: true/);
assert.match(windowSecurity, /sandbox: true/);
assert.match(windowSecurity, /setPermissionRequestHandler/);
assert.match(read('electron/local-protocol.js'), /await fs\.promises\.readFile\(target\)/, 'local renderer assets must not block the Electron main thread on file reads');
assert.match(read('electron/runtime-log-buffer.js'), /fs\.promises\.appendFile/, 'runtime log writes must be asynchronous');
assert.match(read('electron/runtime-log-buffer.js'), /async function flush\(\)/, 'runtime logs must expose a shutdown flush');
assert.match(windowSecurity, /will-download/);

assert.match(appUpdater, /autoDownload = false/);
assert.match(appUpdater, /autoInstallOnAppQuit = false/);
assert.match(appUpdater, /quitAndInstall\(false, true\)/);
assert.match(appUpdater, /integrityVerified/);
assert.match(appUpdaterEvents, /does not match expected version/);
assert.match(desktopLifecycle, /openAtLogin/);
assert.match(desktopLifecycle, /--background/);

assert.match(dashboardJs, /dataset\.surface = surface/);
assert.match(dashboardJs, /initWindowChrome/);
assert.match(dashboardJs, /initUpdateAvailableModal/);
assert.match(dashboardServer, /id="windowTitlebar"[^>]*aria-label="Application title bar"/);
assert.match(dashboardServer, /id="windowMinimizeBtn"[^>]*aria-label="Minimize window"/);
assert.match(dashboardServer, /id="windowMaximizeBtn"[^>]*aria-label="Maximize window"/);
assert.match(dashboardServer, /id="windowCloseBtn"[^>]*aria-label="Close window"/);
assert.match(windowChromePolicy, /platform === 'win32'/);
assert.match(windowChromePolicy, /frame: false/);
assert.match(windowChromePolicy, /titleBarStyle: 'hiddenInset'/);
assert.match(dashboardWindowPolicy, /desktop:window-state/);
assert.match(dashboardWindowPolicy, /fs\.promises\.writeFile\(statePath, text\)/, 'debounced window-bound persistence must not block the Electron main thread');
assert.match(windowChromeUi, /Restore window/);

assert.match(dashboardTokens, /-webkit-app-region: drag/);
assert.match(dashboardTokens, /-webkit-app-region: no-drag/);
assert.match(dashboardTokens, /scrollbar-gutter: stable/);
assert.match(electronCss, /scrollbar-width: thin/);
assert.match(electronCss, /prefers-color-scheme: light/);
assert.equal(fs.existsSync(path.join(root, 'electron/renderer/settings.html')), false);
assert.equal(fs.existsSync(path.join(root, 'electron/renderer/settings.js')), false);

console.log('Tunnel-only desktop UI smoke test passed.');
