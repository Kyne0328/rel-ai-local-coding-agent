import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';

const root = process.env.RELAI_REPOSITORY_ROOT;
const outputPath = process.env.RELAI_PROBE_OUTPUT_PATH;
if (!root || !outputPath) throw new Error('Wizard probe environment is incomplete.');
app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 560,
    height: 760,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  try {
    await win.loadFile(path.join(root, 'electron', 'renderer', 'wizard.html'));
    await waitFor(win, `document.querySelector('#step1.active') && document.querySelector('#p1[aria-current="step"]')`);
    const result = await win.webContents.executeJavaScript(`(async () => {
      try {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const state = () => ({
        activeStep: document.querySelector('.step.active')?.id || '',
        currentProgress: document.querySelector('.progress-step[aria-current="step"]')?.id || '',
        visibleSteps: [...document.querySelectorAll('.step')].filter(step => !step.hidden && step.getAttribute('aria-hidden') !== 'true').map(step => step.id),
        focusId: document.activeElement?.id || '',
        token: document.getElementById('tokenBox')?.textContent || ''
      });
      const tokenInput = document.getElementById('ngrokTokenInput');
      const domainInput = document.getElementById('domainInput');
      tokenInput.value = 'acceptance-authtoken';
      domainInput.value = 'acceptance.ngrok-free.dev';
      tokenInput.dispatchEvent(new Event('input', { bubbles: true }));
      domainInput.dispatchEvent(new Event('input', { bubbles: true }));
      await delay(30);
      const continueEnabled = !document.getElementById('continueConnectionBtn').disabled;
      document.getElementById('continueConnectionBtn').click();
      await delay(30);
      const step2 = state();
      document.querySelector('[data-go="1"]').click();
      await delay(30);
      const backToStep1 = state();
      document.getElementById('continueConnectionBtn').click();
      await delay(30);
      const tokenBeforeReview = document.getElementById('tokenBox').textContent;
      document.getElementById('reviewSetupBtn').click();
      await delay(30);
      const step3 = state();
      const summary = document.getElementById('summaryBox').textContent;
      document.querySelector('[data-go="2"]').click();
      await delay(30);
      const backToStep2 = state();
      domainInput.focus();
      domainInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await delay(30);
      return {
        stepCount: document.querySelectorAll('.step').length,
        continueEnabled,
        step2,
        backToStep1,
        step3,
        backToStep2,
        tokenPreserved: tokenBeforeReview.length > 20 && tokenBeforeReview === backToStep2.token,
        summaryHasEndpoint: summary.includes('https://acceptance.ngrok-free.dev/mcp'),
        externalLinks: [...document.querySelectorAll('[data-link]')].map(button => button.textContent.trim()),
        enterState: state()
      };
      } catch (error) {
        return { scriptError: error?.stack || String(error) };
      }
    })()`);
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  } catch (error) {
    fs.writeFileSync(outputPath, JSON.stringify({ error: error?.stack || String(error) }, null, 2));
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.quit();
  }
}).catch(error => {
  fs.writeFileSync(outputPath, JSON.stringify({ error: error?.stack || String(error) }, null, 2));
  app.exit(1);
});

async function waitFor(win, expression, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}
