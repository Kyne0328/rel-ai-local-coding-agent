import fs from 'node:fs';
import { app, BrowserWindow } from 'electron';

const targetUrl = process.env.RELAI_PROBE_TARGET_URL;
const outputPath = process.env.RELAI_PROBE_OUTPUT_PATH;
if (!targetUrl || !outputPath) throw new Error('Filter probe environment is incomplete.');
app.commandLine.appendSwitch('force-prefers-reduced-motion', 'reduce');
app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 820,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const failures = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) failures.push('console:' + message); });
  try {
    await win.loadURL(targetUrl);
    await waitFor(win, `document.querySelector('#__activity-filter-bar .filter-search-input') && document.querySelectorAll('.activity-message-copy').length > 0`);

    const shared = await win.webContents.executeJavaScript(`(async () => {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const setRadio = (root, label, value) => {
        const field = [...root.querySelectorAll('fieldset')].find(item => item.querySelector('legend')?.textContent.includes(label));
        const input = [...(field?.querySelectorAll('input[type="radio"]') || [])].find(item => item.value === value);
        if (!input) return false;
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };
      const filterButton = document.querySelector('#__activity-filter-bar .filter-open-button');
      const search = document.querySelector('#__activity-filter-bar .filter-search-input');
      filterButton.focus();
      filterButton.click();
      await delay(30);
      const drawer = document.querySelector('.filter-drawer');
      const focusedInside = drawer?.contains(document.activeElement) || false;
      const fixedChoicesVisible = setRadio(drawer, 'Status', 'failed');
      [...drawer.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel')?.click();
      await delay(30);
      const cancelPreserved = document.querySelectorAll('#__activity-filter-bar .filter-chip').length === 0;
      filterButton.click();
      await delay(30);
      const second = document.querySelector('.filter-drawer');
      setRadio(second, 'Time range', '24h');
      setRadio(second, 'Status', 'failed');
      [...second.querySelectorAll('button')].find(button => /Apply filters/.test(button.textContent))?.click();
      await delay(60);
      return {
        searchVisible: Boolean(search && getComputedStyle(search).display !== 'none'),
        searchLabel: search?.closest('label')?.textContent.trim() || '',
        filterButtonLabel: filterButton.getAttribute('aria-label') || '',
        summaryRole: document.querySelector('#__activity-filter-bar .filter-summary')?.getAttribute('role') || '',
        dialogLabel: drawer?.getAttribute('aria-labelledby') === '__relai-drawer-title' && drawer?.getAttribute('role') === 'dialog',
        focusedInside,
        cancelPreserved,
        fixedChoicesVisible
      };
    })()`);
    await waitFor(win, `document.querySelectorAll('#__activity-filter-bar .filter-chip').length === 2 && !document.querySelector('.filter-drawer')`);
    const activityApplied = await win.webContents.executeJavaScript(`(() => {
      const chips = [...document.querySelectorAll('#__activity-filter-bar .filter-chip')];
      const freeze = document.getElementById('__activity-freeze');
      return {
        chipText: chips.map(chip => chip.textContent.trim()),
        chipLabels: chips.map(chip => chip.getAttribute('aria-label') || ''),
        badge: document.querySelector('#__activity-filter-bar .filter-open-button')?.textContent.trim() || '',
        route: location.hash,
        summary: document.querySelector('#__activity-filter-bar .filter-summary')?.textContent.trim() || '',
        freezeExcluded: freeze?.getAttribute('aria-pressed') === 'false' && !/3/.test(document.querySelector('#__activity-filter-bar .filter-open-button')?.textContent || ''),
        freezeLabel: freeze?.getAttribute('aria-label') || '',
        freezeIconOnly: Boolean(freeze?.querySelector('svg') && !freeze.textContent.trim())
      };
    })()`);
    await win.webContents.executeJavaScript(`document.querySelector('#__activity-filter-bar [aria-label^="Remove Status filter"]')?.click()`);
    await waitFor(win, `!document.querySelector('#__activity-filter-bar [aria-label^="Remove Status filter"]') && !location.hash.includes('status=')`);
    await win.webContents.executeJavaScript(`location.hash = '#activity?task=acceptance-failed'`);
    await waitFor(win, `document.querySelector('#__activity-filter-bar [aria-label^="Remove Task filter"]')`);
    const taskChip = await win.webContents.executeJavaScript(`document.querySelector('#__activity-filter-bar [aria-label^="Remove Task filter"]')?.getAttribute('aria-label') || ''`);
    await win.webContents.executeJavaScript(`document.querySelector('#__activity-filter-bar .filter-clear-button')?.click()`);
    await waitFor(win, `document.querySelectorAll('#__activity-filter-bar .filter-chip').length === 0 && !location.hash.includes('?')`);

    const escapeFocus = await win.webContents.executeJavaScript(`(async () => {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const trigger = document.querySelector('#__activity-filter-bar .filter-open-button');
      trigger.focus();
      trigger.click();
      await delay(30);
      document.getElementById('__relai-drawer-backdrop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await delay(30);
      return { closed: !document.querySelector('.filter-drawer'), focusReturned: document.activeElement === trigger };
    })()`);

    win.setSize(420, 760);
    await delay(120);
    const mobileDrawer = await win.webContents.executeJavaScript(`(async () => {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      document.querySelector('#__activity-filter-bar .filter-open-button').click();
      await delay(40);
      const drawer = document.querySelector('.filter-drawer');
      const body = drawer?.querySelector('.drawer-body');
      const footer = drawer?.querySelector('.filter-drawer-footer');
      const rect = drawer?.getBoundingClientRect();
      const footerRect = footer?.getBoundingClientRect();
      const result = {
        viewport: innerWidth,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        bottomSheet: Boolean(rect && Math.abs(rect.bottom - innerHeight) <= 2 && rect.left >= -1 && rect.right <= innerWidth + 1),
        scrollable: Boolean(body && ['auto', 'scroll'].includes(getComputedStyle(body).overflowY)),
        actionsReachable: Boolean(footerRect && footerRect.bottom <= innerHeight + 1 && footerRect.top >= 0)
      };
      [...drawer.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel')?.click();
      return result;
    })()`);

    win.setSize(1100, 820);
    await win.webContents.executeJavaScript(`location.hash = '#diagnostics'`);
    await waitFor(win, `document.querySelector('#diagnosticFilterHost .filter-open-button') && document.querySelector('#diagnosticSummary')`);
    const diagnostics = await win.webContents.executeJavaScript(`(async () => {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const setRadio = (root, label, value) => {
        const field = [...root.querySelectorAll('fieldset')].find(item => item.querySelector('legend')?.textContent.includes(label));
        const input = [...(field?.querySelectorAll('input[type="radio"]') || [])].find(item => item.value === value);
        if (!input) return false;
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };
      const trigger = document.querySelector('#diagnosticFilterHost .filter-open-button');
      trigger.click(); await delay(30);
      let drawer = document.querySelector('.filter-drawer');
      const fixedChoicesVisible = setRadio(drawer, 'Scope', 'failed');
      [...drawer.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel')?.click(); await delay(30);
      const cancelPreserved = document.querySelectorAll('#diagnosticFilterHost .filter-chip').length === 0;
      trigger.click(); await delay(30); drawer = document.querySelector('.filter-drawer');
      setRadio(drawer, 'Scope', 'failed');
      setRadio(drawer, 'Severity', 'error');
      [...drawer.querySelectorAll('button')].find(button => /Apply filters/.test(button.textContent))?.click(); await delay(80);
      const applied = {
        chips: [...document.querySelectorAll('#diagnosticFilterHost .filter-chip')].map(chip => chip.textContent.trim()),
        summary: document.querySelector('#diagnosticFilterHost .filter-summary')?.textContent.trim() || '',
        badge: document.querySelector('#diagnosticFilterHost .filter-open-button')?.textContent.trim() || '',
        liveTailPressed: document.querySelector('[data-live-tail]')?.getAttribute('aria-pressed'),
        reportActions: [...document.querySelectorAll('.diagnostic-page-actions button')].map(button => button.textContent.trim())
      };
      document.querySelector('#diagnosticFilterHost .filter-open-button').click(); await delay(30);
      drawer = document.querySelector('.filter-drawer');
      setRadio(drawer, 'Scope', 'findings');
      const source = [...drawer.querySelectorAll('label')].find(item => item.textContent.includes('Source'))?.querySelector('select');
      const sourceDisabledForFindings = source?.disabled === true && source.value === 'all';
      [...drawer.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel')?.click();
      document.querySelector('#diagnosticFilterHost .filter-clear-button')?.click();
      const initialLiveTailLabel = document.querySelector('[data-live-tail]')?.getAttribute('aria-label') || '';
      document.querySelector('[data-live-tail]')?.click(); await delay(80);
      const liveTailStarted = document.querySelector('[data-live-tail]')?.getAttribute('aria-pressed') === 'true';
      const liveTailActiveLabel = document.querySelector('[data-live-tail]')?.getAttribute('aria-label') || '';
      document.querySelector('[data-live-tail]')?.click(); await delay(80);
      const liveTailStopped = document.querySelector('[data-live-tail]')?.getAttribute('aria-pressed') === 'false';
      const search = document.querySelector('#diagnosticFilterHost .filter-search-input');
      search.value = 'no-diagnostic-match-acceptance'; search.dispatchEvent(new Event('input', { bubbles: true })); await delay(220);
      const searchEmpty = /0 of .* findings.*0 of .* log entries shown/.test(document.querySelector('#diagnosticFilterHost .filter-summary')?.textContent || '');
      document.querySelector('#diagnosticFilterHost .filter-clear-button')?.click();
      const technicalCodes = [...document.querySelectorAll('[data-diagnostic-detail] p code')];
      const technicalFindingCodesGated = technicalCodes.length > 0 && technicalCodes.every(code => Boolean(code.closest('details[data-diagnostic-detail]')));
      const findingSeveritiesReadable = [...document.querySelectorAll('.diagnostic-severity')]
        .every(element => ['Blocking', 'Warning', 'Recommendation'].includes(element.textContent.trim()));
      return { cancelPreserved, fixedChoicesVisible, sourceDisabledForFindings, initialLiveTailLabel, liveTailActiveLabel, liveTailStarted, liveTailStopped, searchEmpty, technicalFindingCodesGated, findingSeveritiesReadable, applied };
    })()`);

    await win.webContents.executeJavaScript(`location.hash = '#tools'`);
    await waitFor(win, `document.querySelector('#toolsToolbar .filter-open-button') && document.querySelectorAll('.tool-card').length > 0`);
    const tools = await win.webContents.executeJavaScript(`(async () => {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const search = document.querySelector('#toolsToolbar .filter-search-input');
      search.value = 'relai'; search.dispatchEvent(new Event('input', { bubbles: true })); await delay(30);
      document.querySelector('#toolsToolbar .filter-open-button').click(); await delay(30);
      const drawer = document.querySelector('.filter-drawer');
      const validate = drawer.querySelector('input[type="radio"][value="validate"]');
      validate.checked = true; validate.dispatchEvent(new Event('change', { bubbles: true }));
      [...drawer.querySelectorAll('button')].find(button => /Apply filters/.test(button.textContent))?.click(); await delay(60);
      const applied = {
        chip: document.querySelector('#toolsToolbar [aria-label^="Remove Capability filter"]')?.getAttribute('aria-label') || '',
        badge: document.querySelector('#toolsToolbar .filter-open-button')?.textContent.trim() || '',
        summary: document.querySelector('#toolsToolbar .filter-summary')?.textContent.trim() || '',
        visibleCards: document.querySelectorAll('.tool-card').length
      };
      document.querySelector('#toolsToolbar [aria-label^="Remove Capability filter"]')?.click(); await delay(30);
      const capabilityRemoved = !document.querySelector('#toolsToolbar [aria-label^="Remove Capability filter"]');
      document.querySelector('#toolsToolbar .filter-clear-button')?.click(); await delay(30);
      const cleared = document.querySelector('#toolsToolbar .filter-search-input')?.value === '';
      const emptySearch = document.querySelector('#toolsToolbar .filter-search-input');
      emptySearch.value = 'no-tool-match-acceptance'; emptySearch.dispatchEvent(new Event('input', { bubbles: true })); await delay(60);
      const emptyState = /No matching tools/.test(document.querySelector('#toolsBody')?.textContent || '');
      document.querySelector('#toolsToolbar .filter-clear-button')?.click();
      return { applied, capabilityRemoved, searchCleared: cleared, emptyState };
    })()`);

    await win.webContents.executeJavaScript(`location.hash = '#settings'`);
    await waitFor(win, `document.querySelector('.settings-content .theme-switch') && !document.querySelector('.settings-rail')`);
    const settings = await win.webContents.executeJavaScript(`(async () => {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const selects = [...document.querySelectorAll('.settings-content select')];
      const theme = document.querySelector('.theme-switch');
      const themes = [];
      for (const value of ['dark', 'light', 'system']) {
        theme.querySelector('[data-theme-option="' + value + '"]').click(); await delay(20);
        themes.push({ preference: document.documentElement.dataset.themePreference, resolved: document.documentElement.dataset.theme });
      }
      return {
        themes,
        themeSwitchLabels: [...theme.querySelectorAll('[data-theme-option]')].map(button => button.getAttribute('aria-label')),
        themeSwitchPressedCount: theme.querySelectorAll('[aria-pressed="true"]').length,
        densityControlRemoved: !selects.some(select => [...select.options].some(option => option.value === 'compact')),
        appearancePreviewRemoved: !document.querySelector('.appearance-preview'),
        legacyDensityIgnored: !document.documentElement.dataset.density,
        secondaryNavigationRemoved: !document.querySelector('.settings-rail') && document.querySelectorAll('.settings-nav-button').length === 0,
        labelsAssociated: [...document.querySelectorAll('.settings-content .settings-field')].every(field => {
          const label = field.querySelector(':scope > label');
          const control = field.querySelector('input, select, textarea');
          return !control || Boolean(label?.htmlFor && control.id === label.htmlFor);
        })
      };
    })()`);

    await win.webContents.executeJavaScript(`location.hash = '#workspaces'`);
    await waitFor(win, `document.querySelector('.workspace-grid')`);
    const workspaces = await win.webContents.executeJavaScript(`(async () => {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitUntil = async (predicate, timeout = 4000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) return true;
          await delay(50);
        }
        return false;
      };
      const validationPreferenceRemoved = !document.querySelector('.workspace-validation-preferences');
      const validationMetricRemoved = !document.querySelector('.summary-metrics')?.textContent.includes('Validation ready');
      const detailsTrigger = document.querySelector('[data-repository-details]');
      detailsTrigger?.click();
      const detailsModal = await waitUntil(() => document.querySelector('#__relai-modal-title')?.textContent.includes('Project details'));
      const detailsInlineVisible = Boolean(document.querySelector('.workspace-details:not([hidden])'));
      document.getElementById('__relai-modal-backdrop')?.click();
      location.hash = '#workspaces?workspace=app';
      await waitUntil(() => Boolean(document.querySelector('.workspace-focus-chip')));
      const focusChipLabel = document.querySelector('.workspace-focus-chip')?.getAttribute('aria-label') || '';
      location.hash = '#tasks';
      await waitUntil(() => Boolean(document.querySelector('.workspace-menu-trigger')));
      return {
        validationPreferenceRemoved,
        validationMetricRemoved,
        detailsModal,
        detailsInlineVisible,
        focusChipLabel,
        scopeName: document.querySelector('.workspace-menu-trigger')?.getAttribute('aria-label') || ''
      };
    })()`);

    await win.webContents.executeJavaScript(`location.hash = '#connection'`);
    await waitFor(win, `document.querySelector('.connection-primary-action')`);
    const connection = await win.webContents.executeJavaScript(`(() => ({
      primaryCount: document.querySelectorAll('.connection-primary-action > a, .connection-primary-action > button').length,
      primaryLabel: document.querySelector('.connection-primary-action')?.textContent.trim() || '',
      primaryTag: document.querySelector('.connection-primary-action > a, .connection-primary-action > button')?.tagName || '',
      detailsDisclosure: Boolean(document.querySelector('.connection-layer-disclosure')),
      technicalDetailsRemoved: !document.querySelector('.connector-technical-details') && !document.body.innerText.includes('Bounded synchronous fallback'),
      secondaryNavigationRemoved: !document.querySelector('.system-rail') && !document.querySelector('#__system-content .settings-rail'),
      navigationLabels: [...document.querySelectorAll('nav[aria-label]')].map(nav => nav.getAttribute('aria-label'))
    }))()`);

    const usage = await win.webContents.executeJavaScript(`(async () => {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      window.relaiDesktop = {
        getGatewayStatus: async () => ({ connectionMode: 'direct' }),
        getGatewayUsage: async () => ({ ok: true }),
        getLocalUsage: async month => ({
          ok: true,
          source: 'local',
          month,
          totals: { requests: 0, toolCalls: 0, successes: 0, failures: 0, requestBytes: 0, resultBytes: 0, executionMs: 0, activeDays: 0 },
          tools: [], devices: [], workspaces: [], series: [], toolSeries: [], workspaceSeries: [], workspaceToolSeries: [],
          failureCategories: [], workspaceFailureCategories: [], failureCategorySeries: [], workspaceFailureCategorySeries: []
        })
      };
      location.hash = '#usage';
      const started = Date.now();
      while (!document.querySelector('.usage-overview') && Date.now() - started < 4000) await delay(50);
      const rangeButton = document.querySelector('[data-usage-range-option="7d"]');
      rangeButton?.click();
      await delay(80);
      const result = {
        overviewVisible: Boolean(document.querySelector('.usage-overview')),
        localAggregate: /Analytics are stored on this computer/.test(document.querySelector('[data-usage-page]')?.textContent || ''),
        modalVisible: Boolean(document.querySelector('#__relai-modal-title')),
        inlineUnavailable: Boolean(document.querySelector('.usage-unavailable')),
        rangeLabels: [...document.querySelectorAll('[data-usage-range-option]')].map(button => button.textContent.trim()),
        rangePressedCount: document.querySelectorAll('[data-usage-range-option][aria-pressed="true"]').length,
        rangeSelectHidden: document.querySelector('[data-usage-range]')?.hidden === true,
        rangeRouteUpdated: location.hash.includes('range=7d')
      };
      delete window.relaiDesktop;
      return result;
    })()`);

    const responsive = [];
    win.show();
    win.focus();
    await win.webContents.setZoomFactor(1);
    for (const requestedWidth of [980, 760, 520, 420]) {
      win.setContentSize(requestedWidth, 760);
      await delay(180);
      await win.webContents.executeJavaScript(`location.hash = '#activity'`);
      await waitFor(win, `document.querySelector('#__activity-filter-bar .filter-open-button')`);
      const measurement = await win.webContents.executeJavaScript(`(() => {
        const controls = [...document.querySelectorAll('#__activity-filter-bar input, #__activity-filter-bar button')].filter(control => control.getClientRects().length > 0 && !control.hidden);
        return {
          width: innerWidth,
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          controlsInViewport: controls.every(control => { const rect = control.getBoundingClientRect(); return rect.left >= -1 && rect.right <= innerWidth + 1; }),
          clippedControls: controls.map(control => { const rect = control.getBoundingClientRect(); return { text: control.getAttribute('aria-label') || control.textContent.trim() || control.placeholder || control.tagName, left: rect.left, right: rect.right, width: rect.width }; }).filter(item => item.left < -1 || item.right > innerWidth + 1),
          searchVisible: Boolean(document.querySelector('#__activity-filter-bar .filter-search-input')?.offsetParent),
          touchTargets: controls.every(control => control.getBoundingClientRect().height >= 30),
          breakpointActive: matchMedia('(max-width: ${requestedWidth}px)').matches
        };
      })()`);
      measurement.requestedWidth = requestedWidth;
      responsive.push(measurement);
    }
    win.setContentSize(840, 760);
    await win.webContents.setZoomFactor(2);
    await delay(180);
    await win.webContents.executeJavaScript(`location.hash = '#activity'`);
    await waitFor(win, `document.querySelector('#__activity-filter-bar .filter-open-button')`);
    const zoom200At420 = await win.webContents.executeJavaScript(`(() => {
      const controls = [...document.querySelectorAll('#__activity-filter-bar input, #__activity-filter-bar button')].filter(control => control.getClientRects().length > 0 && !control.hidden);
      return {
        width: innerWidth,
        zoomFactor: 2,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        controlsInViewport: controls.every(control => { const rect = control.getBoundingClientRect(); return rect.left >= -1 && rect.right <= innerWidth + 1; }),
        searchVisible: Boolean(document.querySelector('#__activity-filter-bar .filter-search-input')?.offsetParent)
      };
    })()`);
    await win.webContents.setZoomFactor(1);
    win.hide();

    let debuggerAttached = false;
    let forcedColors = { active: false, supported: false, visibleBoundary: false };
    try {
      win.webContents.debugger.attach('1.3');
      debuggerAttached = true;
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
      forcedColors = await win.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('#__activity-filter-bar .filter-open-button');
        const style = button ? getComputedStyle(button) : null;
        return { active: matchMedia('(forced-colors: active)').matches, supported: CSS.supports('forced-color-adjust', 'none'), visibleBoundary: Boolean(style && style.borderStyle !== 'none' && style.borderWidth !== '0px') };
      })()`);
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
      if (debuggerAttached) { win.webContents.debugger.detach(); debuggerAttached = false; }
    } catch (error) {
      failures.push('forced-colors:' + (error?.message || String(error)));
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
      debuggerAttached = false;
    }

    fs.writeFileSync(outputPath, JSON.stringify({ shared, activityApplied, taskChip, escapeFocus, mobileDrawer, diagnostics, tools, settings, workspaces, connection, usage, responsive, zoom200At420, forcedColors, failures }, null, 2));
  } catch (error) {
    fs.writeFileSync(outputPath, JSON.stringify({ error: error?.stack || String(error), failures }, null, 2));
    process.exitCode = 1;
  } finally {
    win.destroy(); app.quit();
  }
}).catch(error => { fs.writeFileSync(outputPath, JSON.stringify({ error: error?.stack || String(error) }, null, 2)); app.exit(1); });

async function waitFor(win, expression, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await delay(50);
  }
  throw new Error('Timed out waiting for: ' + expression);
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

