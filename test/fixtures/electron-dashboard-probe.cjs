'use strict';

const fs = require('node:fs');
const [targetUrl, outputPath, screenshotPath] = process.argv.slice(2);
if (outputPath) fs.writeFileSync(outputPath, JSON.stringify({ stage: 'script_started', argv: process.argv }, null, 2));
const { app, BrowserWindow } = require('electron');
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
      indeterminateValid: indeterminate.every(item => item.getAttribute('role') === 'status' && !item.hasAttribute('aria-valuenow')),
      unknownStatusCount: rows.filter(row => /unknown/i.test(row.textContent)).length,
      longTitleAccessible: rows.some(row => row.textContent.includes('Extremely long task title') && (row.getAttribute('aria-label') || row.getAttribute('title') || row.textContent.length > 80)),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      highContrast: matchMedia('(forced-colors: active)').matches,
      bodyWidth: document.documentElement.scrollWidth
    };
  })()`);

  await win.webContents.executeJavaScript(`document.querySelector('.task-row')?.click()`);
  await waitFor(win, `document.querySelector('.session-timeline, .task-session-detail, [data-session-detail]') || document.querySelectorAll('.activity-row-button').length > 0`);
  const taskInteraction = await win.webContents.executeJavaScript(`(() => ({
    selected: Boolean(document.querySelector('.task-row.active, .task-row[aria-current="true"], .task-row.selected')),
    detailText: document.querySelector('#routeRoot')?.textContent || '',
    activityButtons: document.querySelectorAll('.activity-row-button').length
  }))()`);

  await win.webContents.executeJavaScript(`location.hash = '#activity'`);
  await waitFor(win, `document.querySelectorAll('.activity-row-button').length > 0`);
  const beforeFocus = await win.webContents.executeJavaScript(`document.activeElement?.tagName || ''`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'TAB' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'TAB' });
  await delay(50);
  const afterFocus = await win.webContents.executeJavaScript(`({tag: document.activeElement?.tagName || '', className: document.activeElement?.className || ''})`);
  await win.webContents.executeJavaScript(`document.querySelector('.activity-row-button')?.click()`);
  await delay(100);
  const activityInteraction = await win.webContents.executeJavaScript(`(() => ({
    expanded: Boolean(document.querySelector('.activity-detail, .activity-details, [data-activity-detail]')),
    copyButton: Boolean([...document.querySelectorAll('button')].find(button => /copy/i.test(button.textContent))),
    errorWrapped: getComputedStyle(document.querySelector('.activity-table, .activity-detail, #routeRoot')).overflowWrap !== 'normal'
  }))()`);

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
  fs.mkdirSync(require('node:path').dirname(screenshotPath), { recursive: true });
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
