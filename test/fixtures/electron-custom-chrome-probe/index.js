import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const targetUrl = process.env.RELAI_PROBE_TARGET_URL;
const outputPath = process.env.RELAI_PROBE_OUTPUT_PATH;
const expectedToolCount = Number(process.env.RELAI_EXPECTED_TOOL_COUNT || 0);
if (!targetUrl || !outputPath || !Number.isInteger(expectedToolCount) || expectedToolCount < 1) throw new Error('Custom chrome probe environment is incomplete.');

app.whenReady().then(async () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const consoleErrors = [];
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 820,
    frame: false,
    thickFrame: true,
    titleBarStyle: 'hidden',
    hasShadow: true,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(root, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  try {
    win.maximize();
    await win.loadURL(targetUrl);
    await win.webContents.executeJavaScript(`localStorage.setItem('relai_ui_density', 'compact')`);
    await win.loadURL(targetUrl);
    await waitFor(win, `!document.documentElement.dataset.density && document.querySelector('#routeRoot')?.children.length > 0`);
    const measurements = [];
    for (const route of ['usage', 'tools', 'tasks']) {
      await win.webContents.executeJavaScript(`location.hash = '#${route}'`);
      await waitFor(win, `location.hash === '#${route}' && document.querySelector('#routeRoot')?.children.length > 0`);
      if (route === 'tools') await waitFor(win, `document.querySelectorAll('.tool-card').length === ${expectedToolCount}`);
      if (route === 'usage') {
        await waitFor(win, `document.querySelector('[data-usage-page]') && !document.querySelector('[data-usage-unavailable]')`);
      }
      measurements.push(await win.webContents.executeJavaScript(`(() => {
        const titlebar = document.getElementById('windowTitlebar').getBoundingClientRect();
        const shell = document.querySelector('.app-shell').getBoundingClientRect();
        const main = document.getElementById('main').getBoundingClientRect();
        const topbar = document.querySelector('.topbar').getBoundingClientRect();
        const title = document.getElementById('pageTitle').getBoundingClientRect();
        return {
          route: location.hash,
          chrome: document.documentElement.dataset.windowChrome,
          density: document.documentElement.dataset.density || '',
          titlebarBottom: titlebar.bottom,
          shellTop: shell.top,
          mainTop: main.top,
          topbarTop: topbar.top,
          titleTop: title.top,
          localAnalyticsLoaded: location.hash !== '#usage' || Boolean(document.querySelector('.usage-overview')),
          inlineUsageError: Boolean(document.querySelector('[data-usage-unavailable]')),
          toolCategories: location.hash === '#tools' ? Object.fromEntries([...document.querySelectorAll('.tool-card')].map(card => [card.querySelector('code')?.textContent || '', card.querySelector('.tool-capability')?.textContent || ''])) : {},
          titleVisible: title.top >= titlebar.bottom - 0.5,
          shellClear: shell.top >= titlebar.bottom - 0.5,
          mainClear: main.top >= titlebar.bottom - 0.5,
          topbarClear: topbar.top >= titlebar.bottom - 0.5
        };
      })()`));
    }
    fs.writeFileSync(outputPath, JSON.stringify({ measurements }, null, 2));
  } catch (error) {
    let diagnostic = {};
    try {
      diagnostic = await win.webContents.executeJavaScript(`(() => ({ href: location.href, chrome: document.documentElement.dataset.windowChrome || '', bridge: typeof window.relaiDesktop, pageTitle: document.querySelector('#pageTitle')?.textContent || '', contentText: document.querySelector('#routeRoot')?.textContent?.slice(0, 500) || '', bodyText: document.body?.innerText?.slice(0, 800) || '' }))()`);
    } catch {}
    fs.writeFileSync(outputPath, JSON.stringify({ error: error?.stack || String(error), diagnostic, consoleErrors }, null, 2));
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.quit();
  }
});

async function waitFor(win, expression, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}
