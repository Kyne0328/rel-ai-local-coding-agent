import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {
  TERMINOLOGY,
  ERROR_CODES,
  ERROR_GUIDANCE,
  CONNECTION_STATE_VALUES,
  deriveConnectionState,
  errorGuidance,
  errorPayload
} = require('../src/desktopUxContracts.js');
const { createDesktopStatusModel } = require('../electron/desktop-status.js');
const connectionUi = await import('../src/ui/connection-state.js');

assert.deepEqual(TERMINOLOGY, {
  connection: 'Connection',
  approvalToken: 'Approval token',
  sessions: 'Sessions',
  activity: 'Activity',
  tools: 'Tools',
  workspace: 'Workspace'
});
assert.ok(CONNECTION_STATE_VALUES.localService.includes('failed'));
assert.ok(CONNECTION_STATE_VALUES.publicEndpoint.includes('available'));
assert.ok(CONNECTION_STATE_VALUES.chatgptReadiness.includes('authentication_required'));
assert.ok(CONNECTION_STATE_VALUES.dashboardUpdates.includes('reconnecting'));
assert.equal(CONNECTION_STATE_VALUES.dashboardUpdates.includes('polling'), false);

const readyUiState = connectionUi.withConnectionState({
  connectionState: {
    localService: { status: 'running' },
    publicEndpoint: { status: 'available' },
    chatgptReadiness: { status: 'ready' },
    dashboardUpdates: { status: 'offline' },
    error: null
  }
}, 'live').connectionState;
assert.equal(connectionUi.connectionSummary(readyUiState).label, 'Available');
const rendererOwnedLiveState = connectionUi.connectionStateFor({
  connectionState: readyUiState,
  desktopStatus: {
    connectionState: {
      ...readyUiState,
      dashboardUpdates: { status: 'offline' }
    }
  }
});
assert.equal(rendererOwnedLiveState.dashboardUpdates.status, 'live', 'the active renderer stream must override Electron\'s stale dashboard update snapshot');
assert.deepEqual(connectionUi.connectionLayerViews(readyUiState).map(layer => layer.title), [
  'Local service',
  'Public endpoint',
  'ChatGPT readiness',
  'Dashboard updates'
]);
assert.equal(connectionUi.connectionLayerViews(readyUiState)[3].label, 'Live');
assert.equal(connectionUi.connectionSummary({
  ...readyUiState,
  chatgptReadiness: { status: 'authentication_required' }
}).label, 'Approval required');

assert.deepEqual(
  deriveConnectionState({
    serverRunning: true,
    tunnelStatus: 'running',
    mcpUrl: 'https://example.ngrok-free.dev/mcp',
    dashboardUpdateStatus: 'live'
  }),
  {
    localService: { status: 'running' },
    publicEndpoint: { status: 'available' },
    chatgptReadiness: { status: 'ready' },
    dashboardUpdates: { status: 'live' },
    error: null
  }
);

const tokenRejected = deriveConnectionState({
  serverRunning: true,
  tunnelStatus: 'running',
  mcpUrl: 'https://example.ngrok-free.dev/mcp',
  errorCode: ERROR_CODES.APPROVAL_TOKEN_REJECTED,
  error: 'Token rejected.'
});
assert.equal(tokenRejected.localService.status, 'running');
assert.equal(tokenRejected.publicEndpoint.status, 'available');
assert.equal(tokenRejected.chatgptReadiness.status, 'authentication_required');
assert.deepEqual(tokenRejected.error, {
  code: ERROR_CODES.APPROVAL_TOKEN_REJECTED,
  message: 'Token rejected.'
});

const portFailure = deriveConnectionState({
  serverRunning: false,
  tunnelStatus: 'failed',
  errorCode: ERROR_CODES.LOCAL_PORT_IN_USE,
  error: 'Port is in use.',
  dashboardUpdateStatus: 'stopped'
});
assert.equal(portFailure.localService.status, 'failed');
assert.equal(portFailure.publicEndpoint.status, 'unavailable');
assert.equal(portFailure.chatgptReadiness.status, 'unavailable');
assert.equal(portFailure.dashboardUpdates.status, 'offline');

assert.equal(ERROR_GUIDANCE[ERROR_CODES.LOCAL_PORT_IN_USE].href, '#settings/connection');
assert.equal(errorGuidance(ERROR_CODES.APPROVAL_TOKEN_REQUIRED).retryable, false);
assert.equal(ERROR_GUIDANCE[ERROR_CODES.UPDATE_NOT_SUPPORTED].retryable, false);
assert.equal(ERROR_GUIDANCE[ERROR_CODES.UPDATE_INSTALL_BLOCKED].href, '#tasks');
assert.equal(ERROR_GUIDANCE[ERROR_CODES.UPDATE_BUSY].href, '#settings');
assert.equal(ERROR_GUIDANCE[ERROR_CODES.STARTUP_SETTING_NOT_SUPPORTED].retryable, false);
assert.equal(ERROR_GUIDANCE[ERROR_CODES.STARTUP_SETTING_FAILED].href, '#settings');
assert.equal(ERROR_GUIDANCE[ERROR_CODES.LIFECYCLE_STATE_FAILED].href, '#settings/diagnostics');
assert.deepEqual(
  errorPayload('not-a-real-code', 'Failure', { status: 500 }),
  {
    status: 500,
    ok: false,
    errorCode: ERROR_CODES.UNKNOWN,
    error: 'Failure',
    title: 'Unexpected error',
    recovery: {
      message: 'Retry the action. Open Diagnostics if the problem continues.',
      actionLabel: 'Open Diagnostics',
      href: '#settings/diagnostics',
      retryable: true
    }
  }
);

const desktopStatusModel = createDesktopStatusModel({
  version: 'test',
  deriveConnectionState,
  formatError: error => error instanceof Error ? error.message : String(error)
});
const initialDesktopStatus = desktopStatusModel.initial();
assert.equal(initialDesktopStatus.version, 'test');
assert.equal(initialDesktopStatus.connectionState.localService.status, 'stopped');
const failedDesktopStatus = desktopStatusModel.normalize({
  ...initialDesktopStatus,
  ...desktopStatusModel.failure(ERROR_CODES.PUBLIC_ENDPOINT_FAILED, new Error('Endpoint failed.'), {
    serverRunning: true,
    tunnelStatus: 'failed'
  })
});
assert.equal(failedDesktopStatus.errorCode, ERROR_CODES.PUBLIC_ENDPOINT_FAILED);
assert.equal(failedDesktopStatus.connectionState.localService.status, 'running');
assert.equal(failedDesktopStatus.connectionState.publicEndpoint.status, 'unavailable');

const baseline = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'desktop-ux-baseline.json'), 'utf8'));
const dashboardServer = fs.readFileSync(path.join(root, 'src', 'http', 'dashboard.js'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(root, 'public', 'dashboard.js'), 'utf8');
const router = fs.readFileSync(path.join(root, 'src', 'ui', 'router.js'), 'utf8');
const settingsIndex = fs.readFileSync(path.join(root, 'src', 'ui', 'features', 'settings', 'index.js'), 'utf8');
const connectionPage = fs.readFileSync(path.join(root, 'src', 'ui', 'features', 'settings', 'connector.js'), 'utf8');
const electronMain = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const diagnosticsPage = fs.readFileSync(path.join(root, 'src', 'ui', 'features', 'settings', 'diagnostics.js'), 'utf8');
const httpServer = fs.readFileSync(path.join(root, 'src', 'httpServer.js'), 'utf8');
const fallbackStatus = fs.readFileSync(path.join(root, 'electron', 'renderer', 'status.js'), 'utf8');
const commandPalette = fs.readFileSync(path.join(root, 'src', 'ui', 'command-palette.js'), 'utf8');
const activityPage = fs.readFileSync(path.join(root, 'src', 'ui', 'features', 'activity', 'index.js'), 'utf8');
const overlayFocus = fs.readFileSync(path.join(root, 'src', 'ui', 'components', 'overlay-focus.js'), 'utf8');
const wizardHtml = fs.readFileSync(path.join(root, 'electron', 'renderer', 'wizard.html'), 'utf8');
const dashboardSourceCss = fs.readFileSync(path.join(root, 'src', 'ui', 'styles', 'app.css'), 'utf8');
const responsiveCss = dashboardSourceCss;
const dashboardCss = fs.readFileSync(path.join(root, 'public', 'dashboard.css'), 'utf8');
const workspaceCards = fs.readFileSync(path.join(root, 'src', 'ui', 'features', 'workspaces', 'cards.js'), 'utf8');
const workspaceMenu = fs.readFileSync(path.join(root, 'src', 'ui', 'components', 'workspace-menu.js'), 'utf8');
const workspaceCss = dashboardSourceCss;
const finalShellCss = dashboardSourceCss;
const activityCss = dashboardSourceCss;
const settingsCss = dashboardSourceCss;
const componentsCss = dashboardSourceCss;
const electronCss = fs.readFileSync(path.join(root, 'electron', 'renderer', 'app.css'), 'utf8');
const sessionsPage = fs.readFileSync(path.join(root, 'src', 'ui', 'features', 'sessions', 'index.js'), 'utf8');
const updatePage = fs.readFileSync(path.join(root, 'src', 'ui', 'features', 'settings', 'desktop-updates.js'), 'utf8');
const appUpdater = fs.readFileSync(path.join(root, 'electron', 'app-updater.js'), 'utf8');
const dashboardPreload = fs.readFileSync(path.join(root, 'electron', 'dashboard-preload.js'), 'utf8');
const ipcHandlers = fs.readFileSync(path.join(root, 'electron', 'ipc-handlers.js'), 'utf8');
const electronPackage = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'package.json'), 'utf8'));
const releaseWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const lifecyclePage = fs.readFileSync(path.join(root, 'src', 'ui', 'features', 'settings', 'desktop-startup.js'), 'utf8');
const desktopLifecycle = fs.readFileSync(path.join(root, 'electron', 'desktop-lifecycle.js'), 'utf8');
const diagnosticFiles = fs.readFileSync(path.join(root, 'electron', 'diagnostic-files.js'), 'utf8');
const runtimeLogBuffer = fs.readFileSync(path.join(root, 'electron', 'runtime-log-buffer.js'), 'utf8');
const routePolicy = fs.readFileSync(path.join(root, 'src', 'ui', 'route-policy.js'), 'utf8');
const interactionSafety = fs.readFileSync(path.join(root, 'src', 'ui', 'interaction-safety.js'), 'utf8');
const modal = fs.readFileSync(path.join(root, 'src', 'ui', 'components', 'modal.js'), 'utf8');
const confirmDialog = fs.readFileSync(path.join(root, 'src', 'ui', 'components', 'confirm-dialog.js'), 'utf8');
const workspaceForm = fs.readFileSync(path.join(root, 'src', 'ui', 'features', 'workspaces', 'form.js'), 'utf8');
const workspaceRepair = fs.readFileSync(path.join(root, 'src', 'ui', 'features', 'workspaces', 'repair.js'), 'utf8');
const workspaceActions = fs.readFileSync(path.join(root, 'src', 'ui', 'features', 'workspaces', 'actions.js'), 'utf8');
const settingsAdvanced = fs.readFileSync(path.join(root, 'src', 'ui', 'features', 'settings', 'advanced.js'), 'utf8');
const settingsToolsValidation = fs.readFileSync(path.join(root, 'src', 'ui', 'features', 'settings', 'tools-validation.js'), 'utf8');
const desktopConnection = fs.readFileSync(path.join(root, 'src', 'ui', 'features', 'settings', 'desktop-connection.js'), 'utf8');
const desktopSettings = fs.readFileSync(path.join(root, 'electron', 'desktop-settings.js'), 'utf8');
const approvalToken = fs.readFileSync(path.join(root, 'electron', 'approval-token.js'), 'utf8');
const appUpdaterState = fs.readFileSync(path.join(root, 'electron', 'app-updater-state.js'), 'utf8');
const appUpdaterEvents = fs.readFileSync(path.join(root, 'electron', 'app-updater-events.js'), 'utf8');
const updateVersion = fs.readFileSync(path.join(root, 'electron', 'update-version.js'), 'utf8');
const ipcSecurity = fs.readFileSync(path.join(root, 'electron', 'ipc-security.js'), 'utf8');
const windowSecurity = fs.readFileSync(path.join(root, 'electron', 'window-security.js'), 'utf8');
const statusHtml = fs.readFileSync(path.join(root, 'electron', 'renderer', 'status.html'), 'utf8');
const securityDoc = fs.readFileSync(path.join(root, 'docs', 'SECURITY.md'), 'utf8');

assert.equal(baseline.version, 27);
assert.deepEqual(baseline.canonicalRoutes, {
  tools: '#tools',
  general: '#settings',
  connection: '#settings/connection',
  toolsValidation: '#settings/tools-validation',
  diagnostics: '#settings/diagnostics',
  advanced: '#settings/advanced'
});
assert.deepEqual(baseline.connectionLayers, ['Local service', 'Public endpoint', 'ChatGPT readiness', 'Dashboard updates']);
assert.deepEqual(baseline.approvalTokenReplacement, {
  confirmation: 'REPLACE',
  revokesOAuthGrants: true,
  preservesMcpEndpoint: true,
  preservesClientRegistration: true,
  rollbackOnRevokeFailure: true,
  restartFailureReturnsNewToken: true
});
assert.deepEqual(baseline.onboardingPolicy, {
  desktopWizardOwnsPrerequisites: true,
  desktopDashboardModalSuppressed: true,
  desktopHandoffRoute: '#settings/connection',
  desktopHandoffPersistentUntilDismissed: true,
  browserOnboardingPreserved: true,
  recoveryDoesNotResetFirstRun: true
});
assert.deepEqual(baseline.workspaceExperience, {
  visibleReadiness: ['Workspace access', 'Repository', 'Validation'],
  readinessLayout: 'status_strip_with_facts',
  checklistRows: false,
  commonActions: ['Workspace settings', 'Run validation', 'Open folder'],
  advancedDetailsCollapsed: true,
  advancedFormCollapsed: true,
  suggestNameFromFolder: true,
  removalInAdvancedDetails: true,
  renameSupported: true,
  duplicateAliasBlocked: true,
  duplicatePathBlocked: true,
  atomicRenameAndRepair: true,
  recentWorkspaceLimit: 5,
  dedicatedPathRepair: true,
  manageFromSelectors: true
});
assert.deepEqual(baseline.diagnosticsPolicy, {
  singleEndpoint: '/api/diagnostics',
  structuredErrors: true,
  sanitizedReports: true,
  copyReport: true,
  exportState: true,
  filterBySearchSeveritySource: true,
  liveTailIntervalMs: 2000,
  runtimeLogs: true,
  persistentServiceLog: true,
  openDiagnosticsFolder: true,
  historyResetOwnedByDiagnostics: true,
  fullResetConfirmation: 'RESET',
  fallbackReceivesServiceLogs: true
});
assert.deepEqual(baseline.navigationQol, {
  commandPaletteShortcut: 'Ctrl/Cmd+K',
  searchableTargets: ['Pages', 'Settings', 'Actions', 'Workspaces'],
  workspaceQuickNav: false,
  pageOwnedWorkspaceFilters: true,
  manualRefreshControl: false,
  connectionStatusLinksToSettings: true,
  workspaceFocusRoute: true,
  activityFiltersInRoute: true,
  historyControlsRoute: '#settings/diagnostics',
  canonicalRoutePolicy: true,
  sensitiveRouteParamsStripped: true,
  unsavedNavigationGuard: true,
  dirtyModalDismissGuard: true,
  commandPaletteRespectsOverlays: true,
  staleDrawersCloseOnRouteChange: true,
  applicationConfirmations: true
});
assert.deepEqual(baseline.liveUpdatePolicy, {
  toolActivityDriven: true,
  pollingSettingsRemoved: true,
  scopedRouteRendering: true,
  eventStreamHeartbeat: true
});
assert.deepEqual(baseline.accessibilityResponsive, {
  skipLink: true,
  routeAnnouncements: true,
  overlayBackgroundInert: true,
  modalFocusTrap: true,
  drawerFocusTrap: true,
  singleActivityRowTarget: true,
  commandPaletteCombobox: true,
  workspaceFilterListbox: true,
  mobileSafeArea: true,
  minimumTouchTargetPx: 44,
  settingsRailScrollable: true,
  reducedMotion: true,
  electronStepVisibility: true
});
assert.deepEqual(baseline.visualHierarchy, {
  elevatedSurfaces: ['Sidebar', 'Topbar', 'Dialogs', 'Electron setup', 'Electron recovery hero'],
  summaryMetricsGrouped: true,
  workspaceReadinessGrouped: true,
  workspaceChecklistRemoved: true,
  workspaceDecorativeBlobDisabled: true,
  fullWidthDesktopShell: true,
  singlePageHeading: true,
  connectionPathGrouped: true,
  readableDataDensity: true,
  setupPrincipleCards: true,
  connectionSetupCollapsedWhenReady: true,
  connectionLayerSingleStateMarker: true,
  routineStatusGlowDisabled: true,
  unpublishedSessionLabelSuppressed: true,
  settingsPanelsQuiet: true,
  electronSecondaryCardsFlat: true
});
assert.deepEqual(baseline.updatePolicy, {
  installedWindowsAutoCheck: true,
  automaticCheckIntervalHours: 24,
  automaticDownload: false,
  automaticInstall: false,
  portableManualOnly: true,
  downloadProgressVisible: true,
  installBlockedDuringActiveCalls: true,
  downloadIntegrity: 'sha512_release_metadata',
  downloadVersionMustMatch: true,
  downgradeRejected: true,
  checksumManifest: 'SHA256SUMS.txt',
  windowsCodeSigning: 'not_configured',
  releaseMetadata: ['latest.yml', 'blockmap'],
  surface: '#settings',
  trayActions: true
});
assert.deepEqual(baseline.installerPolicy, {
  mode: 'assisted',
  installScopeChoice: true,
  perUserDefault: true,
  allUsersAvailable: true,
  elevationWhenAllUsersSelected: true,
  installationDirectorySelectable: true,
  desktopShortcut: true,
  startMenuShortcut: true,
  runAfterFinishOption: true,
  runAfterFinishDefault: true,
  silentAutomationSupported: true
});
assert.deepEqual(electronPackage.build.nsis, {
  oneClick: false,
  perMachine: false,
  allowElevation: true,
  allowToChangeInstallationDirectory: true,
  createDesktopShortcut: true,
  createStartMenuShortcut: true,
  shortcutName: 'Rel.AI MCP',
  runAfterFinish: true
});
assert.deepEqual(baseline.desktopSecurityPolicy, {
  securedIpcSenders: true,
  localRendererSandbox: true,
  permissionsDenied: true,
  downloadsDenied: true,
  navigationLockedToLocalFile: true,
  contentSecurityPolicy: true,
  ngrokAccountKeyWriteOnly: true,
  clipboardLimitKiB: 64
});
assert.deepEqual(baseline.releaseValidationPolicy, {
  exactInstallerSmoke: true,
  machineReadableEvidence: 'release-readiness.json',
  screenshotArchive: 'release-usability-evidence.zip',
  automatedScenarioCount: 11,
  manualScenarioCount: 4,
  manualStatus: 'required'
});
assert.deepEqual(baseline.lifecyclePolicy, {
  launchAtLoginInstalledWindows: true,
  launchAtLoginPortable: false,
  startupArgument: '--background',
  backgroundStartupOpensDashboard: false,
  versionTransitionRecorded: true,
  uncleanShutdownDetected: true,
  cleanShutdownRecorded: true,
  surface: '#settings',
  stateFile: 'desktop-lifecycle.json'
});
assert.deepEqual(baseline.windowPolicy, {
  routineSurface: 'dashboard',
  fallbackSurface: 'recovery',
  defaultDashboardMode: 'centered_windowed',
  defaultDashboardWorkAreaRatio: 0.8,
  defaultDashboardMaximum: '1180x760',
  normalBoundsPersisted: true,
  legacyBoundsMigrated: true,
  closeHidesToTray: true,
  settingsRendererRemoved: true,
  fallbackExposedByTray: false,
  fallbackExposedByDashboard: false,
  fallbackConnectionEditor: 'wizard',
  fallbackCredentialsViaIpc: true,
  fallbackTokenRotation: false
});
assert.deepEqual(baseline.legacyRoutes, ['#reference', '#settings/connector', '#settings/desktop', '#settings/dashboard']);
assert.deepEqual(baseline.settingsNavigation, ['General', 'Connection', 'Tools & validation', 'Diagnostics', 'Advanced']);
assert.deepEqual(baseline.settingsOwnership.general, ['Appearance', 'Desktop notifications', 'Startup and recovery', 'Application updates']);
assert.deepEqual(baseline.settingsOwnership.connection, ['Connection status', 'Local service', 'Public endpoint', 'Approval token']);
assert.deepEqual(baseline.settingsOwnership.toolsValidation, ['Tool surface', 'Workspace validation']);
assert.deepEqual(baseline.settingsOwnership.diagnostics, ['Findings', 'Service logs', 'Diagnostic export', 'History maintenance']);
assert.deepEqual(baseline.settingsOwnership.advanced, ['Patch safeguards', 'Resource limits']);
for (const label of baseline.mainNavigation) assert.ok(dashboardServer.includes(`label: "${label}"`), `missing baseline navigation label: ${label}`);
for (const label of baseline.settingsNavigation) assert.ok(settingsIndex.includes(`label: '${label}'`), `missing baseline settings label: ${label}`);
for (const surface of baseline.electronSurfaces.filter(item => item.renderer.endsWith('.html'))) {
  assert.equal(fs.existsSync(path.join(root, surface.renderer)), true, `missing baseline renderer: ${surface.renderer}`);
}
for (const screenshot of baseline.screenshots) assert.equal(fs.existsSync(path.join(root, screenshot)), true, `missing baseline screenshot: ${screenshot}`);

assert.match(electronMain, /deriveConnectionState/);
assert.match(electronMain, /errorCode/);
assert.match(electronMain, /createRuntimeLogBuffer/);
assert.match(httpServer, /\/api\/diagnostics/);
assert.match(httpServer, /errorPayload/);
assert.match(diagnosticsPage, /Copy report/);
assert.match(diagnosticsPage, /\/api\/diagnostics\/reset/);
assert.match(fallbackStatus, /onServerLog/);
assert.match(fallbackStatus, /safeDiagnosticText/);
assert.match(commandPalette, /ctrlKey|metaKey/);
assert.match(commandPalette, /Settings · Diagnostics/);
assert.match(commandPalette, /Add workspace/);
assert.match(commandPalette, /role="combobox"/);
assert.match(overlayFocus, /element\.inert = true/);
assert.match(overlayFocus, /event\.key !== 'Tab'/);
assert.match(overlayFocus, /restoreFocus/);
assert.match(dashboardServer, /class="skip-link">Skip to content/);
assert.match(dashboardServer, /id="routeAnnouncer"/);
assert.match(responsiveCss, /env\(safe-area-inset-bottom\)/);
assert.match(responsiveCss, /min-h-11/);
assert.match(wizardHtml, /id="step2"[^>]*aria-hidden="true" hidden/);
assert.match(wizardHtml, /class="setup-principles"/);
assert.doesNotMatch(wizardHtml, /setup-check|setup-benefits/);
assert.match(dashboardCss, /\.summary-metrics/);
assert.match(finalShellCss, /--sidebar-width: 252px/);
assert.match(finalShellCss, /grid-template-columns: var\(--sidebar-width\) minmax\(0, 1fr\)/);
assert.match(workspaceCards, /class="workspace-readiness \$\{view\.available \? 'good' : 'bad'\}"/);
assert.match(workspaceCards, /<dl class="workspace-readiness-facts">/);
assert.doesNotMatch(workspaceCards, /workspace-readiness-item|workspace-readiness-primary/);
assert.match(workspaceCss, /\.workspace-readiness/);
assert.match(workspaceCss, /\.workspace-toolbar button\[data-add-workspace\]/);
assert.match(connectionPage, /connection-setup-details/);
assert.match(connectionPage, /connection-layer-state/);
assert.match(connectionPage, /className = 'connection-path'/);
assert.match(settingsCss, /\.connection-path-step/);
assert.match(activityCss, /\.data-table td[\s\S]*h-\[54px\]/);
assert.doesNotMatch(componentsCss, /\.status-pill\.ok::before[^}]*animation/s);
assert.doesNotMatch(sessionsPage, /Not published/);
assert.match(electronCss, /\.app-card[^}]*box-shadow: none/s);
assert.match(updatePage, /Application updates/);
assert.match(updatePage, /checkForUpdates/);
assert.match(updatePage, /downloadUpdate/);
assert.match(updatePage, /installUpdate/);
assert.match(updatePage, /<progress/);
assert.match(updatePage, /GitHub Releases/);
assert.match(appUpdater, /autoDownload = false/);
assert.match(appUpdater, /autoInstallOnAppQuit = false/);
assert.match(appUpdater, /active Rel\.AI tool call/);
assert.match(dashboardPreload, /desktop:update:get/);
assert.match(dashboardPreload, /desktop:update-status/);
assert.match(dashboardPreload, /desktop:diagnostics:export/);
assert.match(dashboardPreload, /desktop:diagnostics:open-folder/);
assert.match(ipcHandlers, /getDashboardWindow/);
assert.match(ipcHandlers, /desktop:update:install/);
assert.match(electronPackage.dependencies['electron-updater'], /^\^6\./);
assert.equal(electronPackage.build.publish[0].provider, 'github');
assert.match(releaseWorkflow, /latest\.yml/);
assert.match(releaseWorkflow, /\*\.blockmap/);
assert.match(releaseWorkflow, /SHA256SUMS\.txt/);
assert.match(releaseWorkflow, /Get-FileHash/);
assert.match(releaseWorkflow, /sha512:/);
assert.match(appUpdaterState, /integrityVerified/);
assert.match(appUpdaterState, /state === 'downloaded' && value\.integrityVerified === true/);
assert.match(appUpdaterEvents, /not newer than installed version/);
assert.match(appUpdaterEvents, /does not match expected version/);
assert.match(appUpdaterEvents, /integrityVerified: true/);
assert.match(updateVersion, /const match = \/\^\(\\d\+\)\\\.\(\\d\+\)\\\.\(\\d\+\)\$\//);
assert.match(windowSecurity, /sandbox: true/);
assert.match(windowSecurity, /setPermissionRequestHandler/);
assert.match(windowSecurity, /will-download/);
assert.match(windowSecurity, /will-navigate/);
assert.match(windowSecurity, /setWindowOpenHandler/);
assert.match(ipcHandlers, /createWindowGuards/);
assert.match(ipcSecurity, /BrowserWindow\.fromWebContents/);
assert.match(ipcSecurity, /dashboard\.ngrok\.com/);
assert.match(ipcSecurity, /64 \* 1024/);
assert.doesNotMatch(ipcHandlers, /wizard:save-config/);
assert.match(wizardHtml, /Content-Security-Policy/);
assert.match(statusHtml, /Content-Security-Policy/);
assert.match(desktopSettings, /ngrokAuthtoken: ''/);
assert.match(desktopSettings, /ngrokAuthtokenConfigured/);
assert.match(desktopSettings, /replacementAccountKey \|\| current\.ngrokAuthtoken/);
assert.match(desktopConnection, /ngrok account key is write-only/);
assert.match(approvalToken, /original token was restored/);
assert.match(approvalToken, /restartRequired/);
assert.match(approvalToken, /approvalToken,/);
assert.match(securityDoc, /currently unsigned/);
assert.match(securityDoc, /do not prove publisher identity/);
assert.match(lifecyclePage, /Startup and recovery/);
assert.match(lifecyclePage, /Launch Rel\.AI at sign-in/);
assert.match(lifecyclePage, /Update completed/);
assert.match(lifecyclePage, /Recovered after an interrupted exit/);
assert.match(desktopLifecycle, /desktop-lifecycle\.json/);
assert.match(desktopLifecycle, /setLoginItemSettings/);
assert.match(desktopLifecycle, /args: \['--background'\]/);
assert.match(desktopLifecycle, /recoveredAfterUncleanShutdown/);
assert.match(desktopLifecycle, /markCleanShutdown/);
assert.match(electronMain, /background: lifecycleStatus\.openedAtLogin/);
assert.match(electronMain, /if \(!options\.background\) await showDashboardWindow/);
assert.match(dashboardPreload, /desktop:lifecycle:get/);
assert.match(ipcHandlers, /desktop:startup:set/);
assert.match(ipcHandlers, /desktop:diagnostics:export/);
assert.match(ipcHandlers, /desktop:diagnostics:open-folder/);
assert.match(diagnosticsPage, /data-diagnostic-search/);
assert.match(diagnosticsPage, /data-diagnostic-severity/);
assert.match(diagnosticsPage, /data-diagnostic-source/);
assert.match(diagnosticsPage, /LIVE_TAIL_INTERVAL_MS = 2000/);
assert.match(diagnosticsPage, /Type RESET to continue/);
assert.match(diagnosticFiles, /relai-diagnostic-state-/);
assert.match(diagnosticFiles, /sanitizeDiagnosticValue/);
assert.match(runtimeLogBuffer, /service\.log|filePath/);
assert.match(activityPage, /replaceRouteParams/);
assert.match(activityPage, /params\.get\('status'\)/);
assert.match(dashboardServer, /id="commandPaletteBtn"/);
assert.doesNotMatch(dashboardServer, /workspaceQuickNav|Jump to workspace/);
assert.match(dashboardServer, /MOBILE_NAV_ITEMS/);
assert.match(dashboardJs, /tools: element/);
assert.match(dashboardJs, /reference: element/);
assert.match(dashboardJs, /connection: element/);
assert.match(dashboardJs, /connector: element/);
assert.match(router, /normalizeRouteKey/);
assert.match(router, /confirmRouteChange/);
assert.match(routePolicy, /CANONICAL_PATHS/);
assert.match(routePolicy, /SENSITIVE_PARAM/);
assert.match(routePolicy, /resolved\.recognized/);
assert.match(interactionSafety, /beforeunload/);
assert.match(interactionSafety, /data-unsaved-changes/);
assert.match(modal, /confirmOverlayDismiss/);
assert.match(commandPalette, /hasActiveOverlay/);
assert.doesNotMatch(commandPalette, /Refresh dashboard|refreshDashboard/);
assert.match(workspaceMenu, /aria-haspopup="listbox"/);
assert.match(workspaceMenu, /role="listbox"/);
assert.match(workspaceMenu, /role="option"/);
assert.match(dashboardServer, /onToolActivity\(scheduleSnapshot\)/);
assert.doesNotMatch(dashboardServer, /workspaceScope|refreshBtn|topbar-refresh|setInterval\(\(\) => sendSnapshot/);
assert.doesNotMatch(dashboardJs, /configureLiveRefresh|dashboardRefreshSeconds|liveLogPollSeconds/);
assert.doesNotMatch(settingsAdvanced, /Fallback refresh interval|Live event scan interval|Dashboard updates/);
assert.match(dashboardJs, /closeDrawer\(\)/);
assert.match(confirmDialog, /textContent = message/);
assert.match(confirmDialog, /modal\.dismiss\(\)/);
assert.match(workspaceForm, /markUnsaved/);
assert.match(workspaceForm, /modal\?\.dismiss\(\)/);
assert.match(workspaceRepair, /markUnsaved/);
assert.match(workspaceActions, /confirmAction/);
assert.match(settingsAdvanced, /markUnsaved/);
assert.match(settingsToolsValidation, /markUnsaved/);
assert.match(router, /document\.title/);
assert.match(router, /aria-current/);
assert.match(settingsIndex, /connector: 'connection'/);
assert.match(settingsIndex, /normalizeRouteKey/);
assert.match(settingsIndex, /routeHref/);
assert.match(settingsIndex, /navigate\(section\)/);
assert.match(settingsIndex, /id: 'tools-validation', label: 'Tools & validation'/);
assert.match(settingsIndex, /id: 'advanced', label: 'Advanced'/);
assert.match(settingsIndex, /desktop: 'connection'/);
assert.match(settingsIndex, /dashboard: 'advanced'/);
assert.match(connectionPage, /connectionLayerViews/);
assert.doesNotMatch(connectionPage, /Copy URL with token|dashboardToken/);
assert.equal(fs.existsSync(path.join(root, 'src', 'ui', 'sections')), false);
assert.equal(fs.existsSync(path.join(root, 'src', 'ui', 'features', 'settings', 'desktop.js')), false);
assert.equal(fs.existsSync(path.join(root, 'src', 'ui', 'features', 'settings', 'dashboard.js')), false);
assert.equal(baseline.electronSurfaces.some(item => item.id === 'settings-compatibility'), false);
assert.equal(baseline.electronSurfaces.find(item => item.id === 'recovery')?.fallbackOnly, true);
assert.equal(fs.existsSync(path.join(root, 'electron', 'renderer', 'settings.html')), false);
assert.equal(fs.existsSync(path.join(root, 'electron', 'renderer', 'settings.js')), false);
assert.equal(fs.existsSync(path.join(root, 'docs', 'DESKTOP_UX_ARCHITECTURE.md')), true);
assert.equal(fs.existsSync(path.join(root, 'docs', 'USABILITY_ACCEPTANCE.md')), true);

console.log('Desktop UX contracts and baseline passed.');
