import fs from 'node:fs';
import path from 'node:path';

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
    const terminalStatic = [...document.querySelectorAll('.task-progress.static.terminal')];
    return {
      title: document.title,
      rowCount: rows.length,
      rowText: rows.map(row => row.textContent.trim()),
      determinateCount: progress.length,
      determinateValid: progress.every(item => item.max === 100 && item.hasAttribute('value') && item.getAttribute('aria-label')),
      indeterminateCount: indeterminate.length,
      indeterminateValid: indeterminate.every(item => Boolean(item.getAttribute('aria-label')) && !item.hasAttribute('aria-valuenow') && item.querySelector('.task-progress-track')?.getAttribute('aria-hidden') === 'true'),
      terminalStaticCount: terminalStatic.length,
      terminalNoIndeterminate: terminalStatic.every(item => !item.classList.contains('indeterminate') && !item.querySelector('.task-progress-track')),
      unknownStatusCount: rows.filter(row => /unknown/i.test(row.textContent)).length,
      longTitleAccessible: rows.some(row => row.textContent.includes('Extremely long task title') && (row.getAttribute('aria-label') || row.getAttribute('title') || row.textContent.length > 80)),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      highContrast: matchMedia('(forced-colors: active)').matches,
      bodyWidth: document.documentElement.scrollWidth
    };
  })()`);

  await waitFor(win, `document.getElementById('lastUpdated')?.textContent.trim() !== 'Updated just now'`, 10_000);
  const liveToolBefore = await win.webContents.executeJavaScript(`(() => {
    window.__relaiProbeSessionsPage = document.querySelector('.sessions-page');
    return {
      routeReady: Boolean(window.__relaiProbeSessionsPage),
      updated: document.getElementById('lastUpdated')?.textContent.trim() || ''
    };
  })()`);
  fs.writeFileSync(outputPath, JSON.stringify({ stage: 'dashboard_ready', liveToolBefore }, null, 2));
  await waitFor(win, `document.getElementById('lastUpdated')?.textContent.trim() === 'Updated just now'`, 10_000);
  const liveToolUpdate = await win.webContents.executeJavaScript(`(() => {
    const current = document.querySelector('.sessions-page');
    const updated = document.getElementById('lastUpdated')?.textContent.trim() || '';
    return {
      received: updated === 'Updated just now' && updated !== ${JSON.stringify(liveToolBefore.updated)},
      beforeUpdated: ${JSON.stringify(liveToolBefore.updated)},
      afterUpdated: updated,
      sameRouteNode: Boolean(current && current === window.__relaiProbeSessionsPage)
    };
  })()`);

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

  await win.webContents.executeJavaScript(`location.hash = '#activity'`);
  await waitFor(win, `document.querySelectorAll('.activity-row-button').length > 0`);
  const beforeFocus = await win.webContents.executeJavaScript(`document.activeElement?.tagName || ''`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'TAB' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'TAB' });
  await delay(50);
  const afterFocus = await win.webContents.executeJavaScript(`({tag: document.activeElement?.tagName || '', className: document.activeElement?.className || ''})`);
  await win.webContents.executeJavaScript(`document.querySelector('.activity-row-button')?.click()`);
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
    await waitFor(win, `document.querySelector('.activity-message-cell')`);
    const activityMeasurement = await win.webContents.executeJavaScript(`(() => {
      const wrap = document.querySelector('#__activity-table-wrap .table-wrap');
      if (wrap) wrap.scrollLeft = 0;
      const cell = document.querySelector('.activity-message-cell');
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
    taskInteraction,
    activityInteraction,
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
