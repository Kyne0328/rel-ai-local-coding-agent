'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrowserWindow } = require('electron');
const { WINDOW_SIZE_LIMITS } = require('./window-size');
const { resolveResourcePath } = require('./resource-path');

async function runWindowSmoke() {
  await loadRendererSmoke('wizard.html', 'wizard');
  await loadRendererSmoke('settings.html', 'wizard');
  await loadRendererSmoke('status.html', 'status');
  await loadDashboardInteractionSmoke();
}

async function loadRendererSmoke(fileName, type) {
  const limits = WINDOW_SIZE_LIMITS[type];
  const smokeWindow = new BrowserWindow({
    show: false,
    width: limits.minWidth,
    height: limits.minHeight,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  try {
    await smokeWindow.loadFile(path.join(__dirname, 'renderer', fileName));
    const result = await smokeWindow.webContents.executeJavaScript(`({
      hasApi: Boolean(window.electronAPI),
      hasBody: Boolean(document.body),
      hasPrimarySurface: Boolean(document.querySelector('.wizard, .settings-shell, .status-shell'))
    })`);
    if (!result?.hasApi || !result?.hasBody || !result?.hasPrimarySurface) {
      throw new Error(`${fileName} did not initialize its renderer surface.`);
    }
  } finally {
    if (!smokeWindow.isDestroyed()) smokeWindow.destroy();
  }
}

async function loadDashboardInteractionSmoke() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-dashboard-window-smoke-'));
  const workspacePath = path.join(temp, 'workspace');
  const stateDir = path.join(temp, 'state');
  const configPath = path.join(temp, 'config.json');
  const previousConfig = process.env.REL_AI_MCP_CONFIG;
  const previousState = process.env.REL_AI_MCP_STATE_DIR;
  const token = 'window-smoke-token';
  let server = null;
  let smokeWindow = null;

  try {
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ scripts: { check: 'node --check index.js' } }, null, 2));
    fs.writeFileSync(path.join(workspacePath, 'index.js'), 'module.exports = true;\n');
    process.env.REL_AI_MCP_CONFIG = configPath;
    process.env.REL_AI_MCP_STATE_DIR = stateDir;

    const srcPath = resolveResourcePath('src');
    const configModule = require(path.join(srcPath, 'config.js'));
    const config = configModule.makeDefaultConfig();
    config.stateDir = stateDir;
    config.auditLogPath = path.join(stateDir, 'audit.jsonl');
    config.workspaces = {
      smoke: {
        path: workspacePath,
        protectedBranches: ['main'],
        defaultBaseBranch: 'main',
        allowedRemotes: ['origin'],
        commands: {},
        testCommands: { check: 'npm run check' },
        fastTask: { enabled: false }
      }
    };
    configModule.writeConfig(config);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(config.auditLogPath, `${JSON.stringify({
      ts: new Date().toISOString(),
      taskId: 'window-smoke-task',
      operationId: 'window-smoke-operation',
      tool: 'relai_read',
      operation: 'Reading index.js',
      workspace: 'smoke',
      path: 'index.js',
      ok: true,
      ms: 5
    })}\n`);

    const { startHttpServer } = require(path.join(srcPath, 'httpServer.js'));
    server = startHttpServer({ host: '127.0.0.1', port: 0, token, exitOnError: false });
    await waitForListening(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Dashboard smoke server did not expose a TCP port.');

    smokeWindow = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        preload: path.join(__dirname, 'dashboard-preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    await smokeWindow.loadURL(`http://127.0.0.1:${address.port}/dashboard?token=${encodeURIComponent(token)}&surface=desktop`);
    const result = await smokeWindow.webContents.executeJavaScript(`(async () => {
      const waitFor = async (predicate, label, timeoutMs = 7000) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          if (predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Timed out waiting for ' + label);
      };
      await waitFor(() => document.querySelector('#refreshBtn') && document.querySelector('#workspaceScope option[value="smoke"]'), 'dashboard controls');
      const refresh = document.querySelector('#refreshBtn');
      const before = performance.getEntriesByType('resource').filter(entry => entry.name.includes('/api/dashboard/v10')).length;
      refresh.click();
      await waitFor(() => performance.getEntriesByType('resource').filter(entry => entry.name.includes('/api/dashboard/v10')).length > before, 'refresh request');
      await waitFor(() => !refresh.disabled, 'refresh completion');
      const scope = document.querySelector('#workspaceScope');
      scope.value = 'smoke';
      scope.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => location.hash.includes('workspace=smoke'), 'workspace route update');
      location.hash = '#tasks?workspace=smoke';
      await waitFor(() => document.querySelector('[data-task-id="window-smoke-task"]'), 'session row');
      document.querySelector('[data-task-id="window-smoke-task"]').click();
      await waitFor(() => document.querySelector('[data-task-event-link]'), 'clickable session event');
      document.querySelector('[data-task-event-link]').click();
      await waitFor(() => location.hash.startsWith('#activity?') && location.hash.includes('event='), 'activity event route');
      await waitFor(() => document.querySelector('#__relai-drawer-title')?.textContent === 'relai_read', 'exact activity event detail');
      return {
        hasDesktopApi: Boolean(window.relaiDesktop),
        refreshEnabled: !refresh.disabled,
        workspace: scope.value,
        hash: location.hash,
        connectionText: document.querySelector('#connectionStatus')?.textContent || '',
        sessionEventOpened: document.querySelector('#__relai-drawer-title')?.textContent === 'relai_read'
      };
    })()`);
    if (!result?.hasDesktopApi || !result.refreshEnabled || result.workspace !== 'smoke' || !result.hash.includes('workspace=smoke') || !result.sessionEventOpened) {
      throw new Error(`Dashboard interaction smoke failed: ${JSON.stringify(result)}`);
    }
  } finally {
    if (smokeWindow && !smokeWindow.isDestroyed()) smokeWindow.destroy();
    if (server) await closeServer(server);
    if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
    else process.env.REL_AI_MCP_CONFIG = previousConfig;
    if (previousState == null) delete process.env.REL_AI_MCP_STATE_DIR;
    else process.env.REL_AI_MCP_STATE_DIR = previousState;
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function waitForListening(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

function closeServer(server) {
  return new Promise(resolve => {
    if (!server?.listening) return resolve();
    server.close(resolve);
  });
}

module.exports = { runWindowSmoke };
