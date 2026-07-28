import fs from 'node:fs';
import path from 'node:path';
const targetUrl = process.env.RELAI_PROBE_TARGET_URL;
const outputPath = process.env.RELAI_PROBE_OUTPUT_PATH;
const screenshotPath = process.env.RELAI_PROBE_SCREENSHOT_PATH;
if (!targetUrl || !outputPath || !screenshotPath) throw new Error('Electron dashboard probe environment is incomplete.');
fs.writeFileSync(outputPath, JSON.stringify({ stage: 'script_started', argv: process.argv }, null, 2));
let app;
let BrowserWindow;
try {
  ({ app, BrowserWindow } = await import('electron'));
} catch (error) {
  if (outputPath) fs.writeFileSync(outputPath, JSON.stringify({ stage: 'electron_import_failed', error: error?.stack || String(error) }, null, 2));
  throw error;
}
app.commandLine.appendSwitch('force-prefers-reduced-motion', 'reduce');
app.commandLine.appendSwitch('force-high-contrast');
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
  await waitFor(win, `document.querySelectorAll('.task-row').length >= 10`);

  const initial = await win.webContents.executeJavaScript(`(() => {
    const rows = [...document.querySelectorAll('.task-row')];
    const progress = [...document.querySelectorAll('progress.task-progress-track')];
    const indeterminate = [...document.querySelectorAll('.task-progress.indeterminate')];
    return {
      title: document.title,
      rowCount: rows.length,
      rowText: rows.map(row => row.textContent.trim()),
      determinateCount: progress.length,
      determinateValid: progress.every(item => item.max === 100 && item.hasAttribute('value') && item.getAttribute('aria-label')),
      indeterminateCount: indeterminate.length,
      indeterminateValid: indeterminate.every(item => Boolean(item.getAttribute('aria-label')) && !item.hasAttribute('aria-valuenow') && item.querySelector('.task-progress-track')?.getAttribute('aria-hidden') === 'true'),
      unknownStatusCount: rows.filter(row => /unknown/i.test(row.textContent)).length,
      longTitleAccessible: rows.some(row => row.textContent.includes('Extremely long task title') && (row.getAttribute('aria-label') || row.getAttribute('title') || row.textContent.length > 80)),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      highContrast: matchMedia('(forced-colors: active)').matches,
      bodyWidth: document.documentElement.scrollWidth
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
  await waitFor(win, `document.querySelectorAll('.task-row').length >= 10`);
  const clockBefore = await win.webContents.executeJavaScript(`document.querySelector('[data-clock-relative], [data-clock-elapsed-start]')?.textContent || ''`);
  await delay(1250);
  const clockAfter = await win.webContents.executeJavaScript(`document.querySelector('[data-clock-relative], [data-clock-elapsed-start]')?.textContent || ''`);
  await win.webContents.setZoomFactor(2);
  win.setSize(640, 720);
  await delay(150);
  const responsive = await win.webContents.executeJavaScript(`(() => ({
    zoom: window.devicePixelRatio,
    viewport: innerWidth,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    focusedVisible: Boolean(document.activeElement && document.activeElement !== document.body)
  }))()`);

  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, image.toPNG());
  const result = {
    initial,
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
