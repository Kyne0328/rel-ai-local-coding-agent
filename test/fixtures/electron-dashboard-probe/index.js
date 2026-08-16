import fs from 'node:fs';
import path from 'node:path';
import { createHttpMcpSession } from '../../helpers/http-mcp.mjs';

const targetUrl = process.env.RELAI_PROBE_TARGET_URL;
const outputPath = process.env.RELAI_PROBE_OUTPUT_PATH;
const screenshotDir = process.env.RELAI_PROBE_SCREENSHOT_DIR;
if (!targetUrl || !outputPath || !screenshotDir) throw new Error('Electron dashboard probe environment is incomplete.');
fs.writeFileSync(outputPath, JSON.stringify({ stage: 'script_started', argv: process.argv }, null, 2));

let app;
let BrowserWindow;
try {
  ({ app, BrowserWindow } = await import('electron'));
} catch (error) {
  fs.writeFileSync(outputPath, JSON.stringify({ stage: 'electron_import_failed', error: error?.stack || String(error) }, null, 2));
  throw error;
}

app.commandLine.appendSwitch('force-prefers-reduced-motion', 'reduce');
app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  fs.writeFileSync(outputPath, JSON.stringify({ stage: 'app_ready' }, null, 2));
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true
    }
  });
  const failures = [];
  win.webContents.session.webRequest.onCompleted({ urls: ['http://*/*'] }, details => {
    if (details.statusCode >= 400) failures.push(`http:${details.statusCode}:${details.url}`);
  });
  win.webContents.session.webRequest.onErrorOccurred({ urls: ['http://*/*'] }, details => {
    failures.push(`network:${details.error}:${details.url}`);
  });
  const navigationCounts = { didStartNavigation: 0, didNavigate: 0, didFinishLoad: 0 };
  win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) navigationCounts.didStartNavigation += 1;
  });
  win.webContents.on('did-navigate', () => { navigationCounts.didNavigate += 1; });
  win.webContents.on('did-finish-load', () => { navigationCounts.didFinishLoad += 1; });
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) failures.push(`console:${message}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => failures.push(`renderer:${details.reason}`));
  await win.loadURL(targetUrl);
  await waitFor(win, `document.querySelectorAll('.task-row').length >= 9`);

  const initial = await win.webContents.executeJavaScript(`(() => {
    const rows = [...document.querySelectorAll('.task-row')];
    const progress = [...document.querySelectorAll('progress.task-progress-track')];
    const indeterminate = [...document.querySelectorAll('.task-progress.indeterminate')];
    const terminalRows = rows.filter(row => ['acceptance-completed', 'acceptance-failed', 'acceptance-cancelled'].includes(row.dataset.taskId));
    return {
      title: document.title,
      rowCount: rows.length,
      rowText: rows.map(row => row.textContent.trim()),
      determinateCount: progress.length,
      determinateValid: progress.every(item => item.max === 100 && item.hasAttribute('value') && item.getAttribute('aria-label')),
      indeterminateCount: indeterminate.length,
      indeterminateValid: indeterminate.every(item => Boolean(item.getAttribute('aria-label')) && !item.hasAttribute('aria-valuenow') && item.querySelector('.task-progress-track')?.getAttribute('aria-hidden') === 'true'),
      terminalRowCount: terminalRows.length,
      terminalLiveClockCount: terminalRows.filter(row => row.querySelector('[data-clock-elapsed-start]')).length,
      terminalDurationVisible: terminalRows.every(row => Boolean(row.querySelector('.task-row-time')?.textContent.trim())),
      terminalNoProgress: terminalRows.every(row => !row.querySelector('.task-progress')),
      unknownStatusCount: rows.filter(row => /unknown/i.test(row.textContent)).length,
      longTitleAccessible: rows.some(row => row.textContent.includes('Extremely long task title') && (row.getAttribute('aria-label') || row.getAttribute('title') || row.textContent.length > 80)),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      highContrast: matchMedia('(forced-colors: active)').matches,
      bodyWidth: document.documentElement.scrollWidth
    };
  })()`);

  const liveToolBefore = await win.webContents.executeJavaScript(`(() => {
    window.__relaiProbeSessionsPage = document.querySelector('.sessions-page');
    window.__relaiProbeLiveToolUpdate = null;
    window.__relaiProbeLiveToolListener = event => {
      if (event.detail?.type !== 'connection.updated') return;
      const recentEvents = event.detail?.data?.mcpConnection?.recentEvents || [];
      const request = recentEvents.find(item => (
        item?.type === 'mcp_request_received'
        && item?.method === 'tools/list'
        && item?.clientInfo?.name === 'dashboard-live-rendering-acceptance'
      ));
      if (!request) return;
      window.setTimeout(() => {
        window.__relaiProbeLiveToolUpdate = {
          type: event.detail.type,
          requestId: request.requestId || ''
        };
      }, 0);
    };
    window.addEventListener('relai:diagnostics-live', window.__relaiProbeLiveToolListener);
    return {
      routeReady: Boolean(window.__relaiProbeSessionsPage),
      updated: document.getElementById('lastUpdated')?.textContent.trim() || ''
    };
  })()`);
  fs.writeFileSync(outputPath, JSON.stringify({ stage: 'dashboard_ready', liveToolBefore }, null, 2));
  await waitFor(win, `Boolean(window.__relaiProbeLiveToolUpdate)`, 10_000);
  const liveToolUpdate = await win.webContents.executeJavaScript(`(() => {
    const current = document.querySelector('.sessions-page');
    const updated = document.getElementById('lastUpdated')?.textContent.trim() || '';
    return {
      received: Boolean(window.__relaiProbeLiveToolUpdate),
      eventType: window.__relaiProbeLiveToolUpdate?.type || '',
      requestId: window.__relaiProbeLiveToolUpdate?.requestId || '',
      beforeUpdated: ${JSON.stringify(liveToolBefore.updated)},
      afterUpdated: updated,
      sameRouteNode: Boolean(current && current === window.__relaiProbeSessionsPage)
    };
  })()`);

  await win.webContents.executeJavaScript(`localStorage.setItem('relai_debug', '1')`);
  const navigationInteractions = await exerciseNavigationControls(win, failures);

  const parsedTarget = new URL(targetUrl);
  const passiveMcpSession = await createHttpMcpSession(parsedTarget.origin, {
    token: parsedTarget.searchParams.get('token') || '',
    clientName: 'dashboard-passive-route-probe'
  });
  const passiveRouteStability = [];
  for (const route of [
    { hash: 'settings', ready: `document.querySelector('#__settings-content .theme-switch') && !document.querySelector('.settings-loading')` },
    { hash: 'diagnostics', ready: `document.querySelector('.diagnostic-page') && !document.querySelector('[data-copy-report]')?.disabled` },
    { hash: 'workspaces', ready: `document.querySelector('.workspace-grid')` },
    { hash: 'tools', ready: `document.querySelector('.tools-section') && document.getElementById('toolsCount')?.textContent.trim() !== 'Loading…'` }
  ]) {
    passiveRouteStability.push(await measurePassiveRouteStability(win, passiveMcpSession, navigationCounts, route));
  }
  await passiveMcpSession.close();

  await win.webContents.executeJavaScript(`location.hash = '#tasks'`);
  await waitFor(win, `document.querySelectorAll('.task-row').length >= 9`);
  await win.webContents.executeJavaScript(`document.querySelector('.task-row')?.click()`);
  await waitFor(win, `document.querySelector('.session-detail-drawer .session-detail')`);
  const taskInteraction = await win.webContents.executeJavaScript(`(() => {
    const dialog = document.querySelector('.session-detail-drawer');
    const detail = dialog?.querySelector('.session-detail');
    return {
      dialog: dialog?.getAttribute('role') === 'dialog',
      detailText: detail?.textContent || '',
      workSessionId: /Work session ID/.test(detail?.textContent || ''),
      processId: /Process ID/.test(detail?.textContent || ''),
      eventLinks: detail?.querySelectorAll('.task-event-link').length || 0
    };
  })()`);
  await win.webContents.executeJavaScript(`document.querySelector('.session-detail-drawer .drawer-head button')?.click()`);
  await waitFor(win, `!document.querySelector('.session-detail-drawer')`);

  await win.webContents.setZoomFactor(1);
  win.setSize(1600, 900);
  await delay(150);
  await win.webContents.executeJavaScript(`location.hash = '#activity'`);
  await waitFor(win, `document.querySelector('.activity-table tbody .activity-row-button')`);
  const activityDesktopGeometry = await win.webContents.executeJavaScript(`(() => {
    const table = document.querySelector('.activity-table');
    const wrap = document.querySelector('#__activity-table-wrap .table-wrap');
    const headers = [...document.querySelectorAll('.activity-table thead th')]
      .filter(cell => getComputedStyle(cell).display !== 'none')
      .map(cell => ({ text: cell.textContent.trim(), width: cell.getBoundingClientRect().width }));
    const messageHeader = document.querySelector('.activity-table thead .activity-message-column');
    const messageCell = document.querySelector('.activity-message-cell');
    const headerRect = messageHeader?.getBoundingClientRect();
    const cellRect = messageCell?.getBoundingClientRect();
    const wrapRect = wrap?.getBoundingClientRect();
    const visibleHeaderWidth = headers.reduce((sum, item) => sum + item.width, 0);
    return {
      viewportWidth: innerWidth,
      tableWidth: table?.getBoundingClientRect().width || 0,
      wrapWidth: wrapRect?.width || 0,
      visibleHeaderWidth,
      trailingWidthGap: Math.max(0, (wrapRect?.width || 0) - visibleHeaderWidth),
      visibleHeaders: headers.map(item => item.text),
      headerWidth: headerRect?.width || 0,
      cellWidth: cellRect?.width || 0,
      headerVisible: Boolean(messageHeader && getComputedStyle(messageHeader).display !== 'none' && headerRect && wrapRect && headerRect.width > 0 && headerRect.right > wrapRect.left && headerRect.left < wrapRect.right),
      cellVisible: Boolean(messageCell && getComputedStyle(messageCell).display !== 'none' && cellRect && wrapRect && cellRect.width > 0 && cellRect.right > wrapRect.left && cellRect.left < wrapRect.right),
      messageText: messageCell?.querySelector('.activity-message-copy')?.textContent.trim() || ''
    };
  })()`);
  const activityLiveStability = await win.webContents.executeJavaScript(`(async () => {
    const beforeNode = document.querySelector('.activity-message-copy');
    const beforeText = beforeNode?.textContent.trim() || '';
    const tbody = document.getElementById('__activity-tbody');
    let childListMutations = 0;
    const observer = new MutationObserver(records => {
      childListMutations += records.filter(record => record.type === 'childList').length;
    });
    if (tbody) observer.observe(tbody, { childList: true, subtree: true });
    for (let index = 0; index < 3; index += 1) {
      window.dispatchEvent(new CustomEvent('relai:clock-tick', { detail: { now: Date.now() } }));
    }
    window.dispatchEvent(new CustomEvent('relai:dashboard-refresh'));
    await new Promise(resolve => setTimeout(resolve, 750));
    observer.disconnect();
    const afterNode = document.querySelector('.activity-message-copy');
    const pauseButton = document.getElementById('__activity-freeze');
    pauseButton?.click();
    const frozen = pauseButton?.getAttribute('aria-pressed') === 'true';
    pauseButton?.click();
    await new Promise(resolve => setTimeout(resolve, 750));
    const resumed = pauseButton?.getAttribute('aria-pressed') === 'false';
    return {
      beforeText,
      afterText: afterNode?.textContent.trim() || '',
      sameMessageNode: Boolean(beforeNode && beforeNode === afterNode),
      childListMutations,
      messageCount: document.querySelectorAll('.activity-message-copy').length,
      frozen,
      resumed,
      messageAfterResume: document.querySelector('.activity-message-copy')?.textContent.trim() || ''
    };
  })()`);
  const beforeFocus = await win.webContents.executeJavaScript(`document.activeElement?.tagName || ''`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'TAB' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'TAB' });
  await delay(50);
  const afterFocus = await win.webContents.executeJavaScript(`({tag: document.activeElement?.tagName || '', className: document.activeElement?.className || ''})`);
  await win.webContents.executeJavaScript(`document.querySelector('.activity-table tbody .activity-row-button')?.click()`);
  await waitFor(win, `document.querySelector('.drawer-panel .activity-detail-head')`);
  const activityInteraction = await win.webContents.executeJavaScript(`(() => {
    const detail = document.querySelector('.drawer-panel .activity-detail-head');
    const pre = document.querySelector('.drawer-panel .detail-pre');
    return {
      expanded: Boolean(detail),
      copyButton: Boolean([...document.querySelectorAll('.drawer-panel button')].find(button => /copy event json/i.test(button.textContent))),
      errorWrapped: pre ? getComputedStyle(pre).overflowWrap !== 'normal' : false
    };
  })()`);
  await win.webContents.executeJavaScript(`document.querySelector('.drawer-panel .drawer-head button')?.click()`);
  await waitFor(win, `!document.querySelector('#__relai-drawer-backdrop')`);
  await win.webContents.executeJavaScript(`location.hash = '#tasks'`);
  await waitFor(win, `document.querySelectorAll('.task-row').length >= 9`);
  const clockBefore = await win.webContents.executeJavaScript(`document.querySelector('[data-clock-relative], [data-clock-elapsed-start]')?.textContent || ''`);
  await delay(1250);
  const clockAfter = await win.webContents.executeJavaScript(`document.querySelector('[data-clock-relative], [data-clock-elapsed-start]')?.textContent || ''`);

  fs.mkdirSync(screenshotDir, { recursive: true });
  win.show();
  win.focus();
  await delay(200);
  const responsive = [];
  for (const scenario of [
    { name: 'window-640x720', width: 640, height: 720, zoom: 1, theme: 'dark' },
    { name: 'css-320-zoom-200', width: 640, height: 720, zoom: 2, theme: 'light' },
    { name: 'css-375-zoom-200', width: 750, height: 720, zoom: 2, theme: 'dark' },
    { name: 'zoom-400', width: 640, height: 720, zoom: 4, theme: 'light' }
  ]) {
    await win.webContents.setZoomFactor(scenario.zoom);
    win.setSize(scenario.width, scenario.height);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'TAB' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'TAB' });
    await win.webContents.executeJavaScript(`(() => {
      document.documentElement.dataset.theme = ${JSON.stringify(scenario.theme)};
      const row = document.querySelector('.task-row');
      row?.scrollIntoView({ block: 'center', inline: 'nearest' });
      row?.focus();
    })()`);
    await delay(200);
    const focusBeforeTab = await win.webContents.executeJavaScript(`document.activeElement?.getAttribute('data-task-id') || document.activeElement?.id || document.activeElement?.tagName || ''`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'TAB' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'TAB' });
    await delay(50);
    const measurement = await win.webContents.executeJavaScript(`(() => {
      const intersects = element => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
      };
      const topbar = document.querySelector('.topbar');
      const rows = [...document.querySelectorAll('.task-row')];
      const visibleRow = rows.find(intersects) || rows[0];
      const status = visibleRow?.querySelector('.status-pill');
      const primaryControls = [...document.querySelectorAll('.top-controls button, .top-controls a, .task-row')];
      const active = document.activeElement;
      const activeStyle = active && active !== document.body ? getComputedStyle(active) : null;
      const focusVisible = Boolean(activeStyle && ((activeStyle.outlineStyle !== 'none' && activeStyle.outlineWidth !== '0px') || activeStyle.boxShadow !== 'none'));
      return {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        topbarIntersects: intersects(topbar),
        taskRowIntersects: rows.some(intersects),
        primaryControlIntersects: primaryControls.some(intersects),
        focusVisible,
        focusOutline: activeStyle ? activeStyle.outlineStyle + ' ' + activeStyle.outlineWidth : '',
        focusBoxShadow: activeStyle?.boxShadow || '',
        activeClass: active?.className || '',
        activeMatchesTaskRowFocus: Boolean(active?.matches?.('.task-row:focus')),
        focusAfterTab: active?.getAttribute('data-task-id') || active?.id || active?.tagName || '',
        statusText: status?.textContent.trim() || '',
        longContentContained: rows.length > 0 && rows.every(row => row.scrollWidth <= row.clientWidth + 1),
        theme: document.documentElement.dataset.theme,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        forcedColorsActive: matchMedia('(forced-colors: active)').matches,
        forcedColorsSupported: CSS.supports('forced-color-adjust', 'none')
      };
    })()`);
    await win.webContents.executeJavaScript(`location.hash = '#activity'`);
    await waitFor(win, `document.querySelector('.activity-table tbody .activity-row-button')`);
    const activityMeasurement = await win.webContents.executeJavaScript(`(() => {
      const wrap = document.querySelector('#__activity-table-wrap .table-wrap');
      if (wrap) wrap.scrollLeft = 0;
      const cell = document.querySelector('.activity-table tbody .activity-row-button')?.closest('tr')?.querySelector('.activity-message-cell');
      const rect = cell?.getBoundingClientRect();
      const wrapRect = wrap?.getBoundingClientRect();
      return {
        activityHorizontalOverflow: Boolean(wrap && wrap.scrollWidth > wrap.clientWidth + 1),
        activityMessageVisible: Boolean(rect && wrapRect && rect.width > 0 && rect.right > wrapRect.left && rect.left < wrapRect.right && getComputedStyle(cell).display !== 'none'),
        activityMessageText: cell?.textContent.trim() || '',
        activityScrollLeft: wrap?.scrollLeft || 0
      };
    })()`);
    Object.assign(measurement, activityMeasurement);
    await win.webContents.executeJavaScript(`location.hash = '#tasks'`);
    await waitFor(win, `document.querySelectorAll('.task-row').length >= 9`);
    measurement.name = scenario.name;
    measurement.zoomFactor = scenario.zoom;
    measurement.windowWidth = scenario.width;
    measurement.windowHeight = scenario.height;
    measurement.keyboardAdvanced = Boolean(focusBeforeTab && measurement.focusAfterTab && focusBeforeTab !== measurement.focusAfterTab);
    const screenshotPath = path.join(screenshotDir, `${scenario.name}.png`);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(screenshotPath, image.toPNG());
    measurement.screenshot = screenshotPath;
    responsive.push(measurement);
  }

  const result = {
    initial,
    liveToolUpdate,
    navigationInteractions,
    passiveRouteStability,
    taskInteraction,
    activityInteraction,
    activityDesktopGeometry,
    activityLiveStability,
    keyboard: { beforeFocus, afterFocus },
    clock: { before: clockBefore, after: clockAfter, changed: clockBefore !== clockAfter },
    responsive,
    failures
  };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  await win.close();
  app.quit();
}).catch(error => {
  fs.writeFileSync(outputPath, JSON.stringify({ error: error?.stack || String(error) }, null, 2));
  app.exit(1);
});

async function measurePassiveRouteStability(win, mcpSession, navigationCounts, route) {
  await win.webContents.executeJavaScript(`(() => {
    window.removeEventListener('relai:route-mounted', window.__relaiPassiveRouteMountListener);
    window.__relaiPassiveRouteMounted = false;
    const expectedPath = ${JSON.stringify(route.hash)};
    window.__relaiPassiveRouteMountListener = event => {
      if (event.detail?.path !== expectedPath) return;
      window.__relaiPassiveRouteMounted = true;
      window.removeEventListener('relai:route-mounted', window.__relaiPassiveRouteMountListener);
      window.__relaiPassiveRouteMountListener = null;
    };
    window.addEventListener('relai:route-mounted', window.__relaiPassiveRouteMountListener);
    location.hash = ${JSON.stringify(`#${route.hash}`)};
  })()`);
  await waitFor(win, `window.__relaiPassiveRouteMounted === true && (${route.ready})`);
  const beforeNavigation = { ...navigationCounts };
  const captured = await win.webContents.executeJavaScript(`(() => {
    const routeRoot = document.getElementById('routeRoot');
    window.__relaiPassiveRouteNode = routeRoot?.firstElementChild || null;
    window.__relaiPassiveLoadingSeen = false;
    window.__relaiPassiveObserver?.disconnect();
    const loadingPattern = /Loading (?:preferences|application settings|advanced settings|connection details|diagnostics|skills|tools)/i;
    const containsLoading = node => {
      if (!(node instanceof Element)) return false;
      if (node.matches('.settings-loading,.connection-loading')) return true;
      if (node.querySelector('.settings-loading,.connection-loading')) return true;
      return loadingPattern.test(node.textContent || '');
    };
    window.__relaiPassiveObserver = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (containsLoading(node)) window.__relaiPassiveLoadingSeen = true;
        }
      }
    });
    if (routeRoot) window.__relaiPassiveObserver.observe(routeRoot, { childList: true, subtree: true });
    return Boolean(window.__relaiPassiveRouteNode);
  })()`);
  if (!captured) throw new Error(`Passive route probe could not capture #${route.hash}.`);
  const listed = await mcpSession.request('tools/list');
  if (listed.response.status !== 200) throw new Error(`Passive route MCP request failed on #${route.hash}: ${listed.response.status}`);
  await delay(500);
  const dom = await win.webContents.executeJavaScript(`(() => {
    const routeRoot = document.getElementById('routeRoot');
    const current = routeRoot?.firstElementChild || null;
    const result = {
      sameRouteNode: Boolean(current && current === window.__relaiPassiveRouteNode),
      loadingSeen: window.__relaiPassiveLoadingSeen === true,
      routeText: current?.textContent?.slice(0, 160) || ''
    };
    window.__relaiPassiveObserver?.disconnect();
    window.__relaiPassiveObserver = null;
    return result;
  })()`);
  return {
    route: route.hash,
    ...dom,
    mainFrameNavigationDelta: {
      didStartNavigation: navigationCounts.didStartNavigation - beforeNavigation.didStartNavigation,
      didNavigate: navigationCounts.didNavigate - beforeNavigation.didNavigate,
      didFinishLoad: navigationCounts.didFinishLoad - beforeNavigation.didFinishLoad
    }
  };
}

async function exerciseNavigationControls(win, failures) {
  const scenarios = [
    { selector: '.nav a[data-nav-id="workspaces"]', hash: '#workspaces', ready: `document.querySelector('.workspace-grid')` },
    { opener: '[data-nav-accordion="system"] > summary', selector: '[data-nav-accordion="system"] .sidebar-subnav a[data-nav-id="connection"]', hash: '#connection', ready: `document.querySelector('#__system-content .connection-page')` },
    { opener: '[data-nav-accordion="settings"] > summary', selector: '[data-nav-accordion="settings"] .sidebar-subnav a[data-nav-id="preferences"]', hash: '#settings', ready: `document.querySelector('#__settings-content .theme-switch') && !document.querySelector('.settings-loading')` },
    { selector: '[data-nav-accordion="settings"] .sidebar-subnav a[data-nav-id="application"]', hash: '#settings/application', ready: `document.querySelector('#__settings-content .application-update-panel') && !document.querySelector('.settings-loading')` },
    { selector: '[data-nav-accordion="settings"] .sidebar-subnav a[data-nav-id="about"]', hash: '#settings/about', ready: `document.querySelector('#__settings-content .about-product') && !document.querySelector('.settings-loading')` }
  ];
  const results = [];
  for (const scenario of scenarios) {
    if (scenario.opener) {
      await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(scenario.opener)})?.click()`);
      await waitFor(win, `document.querySelector(${JSON.stringify(scenario.opener)})?.parentElement?.open === true`);
    }
    const hitTarget = await win.webContents.executeJavaScript(`(() => {
      const control = document.querySelector(${JSON.stringify(scenario.selector)});
      if (!control) return null;
      control.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = control.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      const hit = document.elementFromPoint(x, y);
      return { x, y, tag: hit?.tagName || '', label: hit?.textContent?.trim() || '', ownsControl: Boolean(hit && (hit === control || control.contains(hit))) };
    })()`);
    if (!hitTarget) throw new Error(`Navigation control is missing: ${scenario.selector}`);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: hitTarget.x, y: hitTarget.y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: hitTarget.x, y: hitTarget.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: hitTarget.x, y: hitTarget.y, button: 'left', clickCount: 1 });
    try {
      await waitFor(win, `location.hash === ${JSON.stringify(scenario.hash)} && (${scenario.ready})`);
    } catch (error) {
      const state = await win.webContents.executeJavaScript(`({ hash: location.hash, title: document.title, pageTitle: document.getElementById('pageTitle')?.textContent || '', content: document.getElementById('routeRoot')?.textContent?.slice(0, 300) || '' })`);
      throw new Error(`${error.message} hit=${JSON.stringify(hitTarget)} state=${JSON.stringify(state)} failures=${JSON.stringify(failures)}`, { cause: error });
    }
    results.push({ ...scenario, hitTarget, opened: true });
  }
  return results;
}

async function waitFor(win, expression, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
