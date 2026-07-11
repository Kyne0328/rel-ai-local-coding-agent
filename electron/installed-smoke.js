// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** @typedef {import('../types/boundaries').InstalledSmokeResult} InstalledSmokeResult */
/** @typedef {{ resourcesPath?: string }} ElectronProcess */

/**
 * Exercise the packaged application without opening a window or tunnel.
 * The caller must provide isolated config and result paths through environment variables.
 * @param {{ isPackaged: boolean, getVersion(): string }} app
 * @returns {Promise<InstalledSmokeResult>}
 */
async function runInstalledSmoke(app) {
  if (app.isPackaged !== true) throw new Error('Installed smoke mode requires a packaged application.');
  const resultPath = requiredEnv('REL_AI_INSTALL_SMOKE_RESULT');
  const configPath = requiredEnv('REL_AI_MCP_CONFIG');
  const resourcesPath = requiredResourcesPath();

  const requiredResources = {
    httpServer: path.join(resourcesPath, 'src', 'httpServer.js'),
    toolRegistry: path.join(resourcesPath, 'src', 'tools', 'registry.js'),
    config: path.join(resourcesPath, 'src', 'config.js'),
    httpCli: path.join(resourcesPath, 'bin', 'rel-ai-mcp-http.js'),
    dashboard: path.join(resourcesPath, 'public', 'dashboard.js'),
    tasksView: path.join(resourcesPath, 'src', 'ui', 'sections', 'tasks.js'),
    taskHistory: path.join(resourcesPath, 'src', 'taskHistory.js'),
    workspaceState: path.join(resourcesPath, 'src', 'workspaceState.js'),
    dashboardSessions: path.join(resourcesPath, 'src', 'http', 'dashboardSessions.js'),
    dashboardActions: path.join(resourcesPath, 'src', 'http', 'dashboardActions.js'),
    dashboardWindow: path.join(__dirname, 'dashboard-window.js'),
    packageJson: path.join(resourcesPath, 'package.json'),
    changelog: path.join(resourcesPath, 'CHANGELOG.md'),
    wizard: path.join(__dirname, 'renderer', 'wizard.html'),
    status: path.join(__dirname, 'renderer', 'status.html')
  };
  const resourceChecks = Object.fromEntries(
    Object.entries(requiredResources).map(([name, file]) => [name, fs.existsSync(file)])
  );
  const missing = Object.entries(resourceChecks).filter(([, present]) => !present).map(([name]) => name);
  if (missing.length) throw new Error(`Packaged resources are missing: ${missing.join(', ')}`);

  process.env.REL_AI_MCP_CONFIG = configPath;
  const configModule = require(requiredResources.config);
  if (!fs.existsSync(configPath)) configModule.writeConfig(configModule.makeDefaultConfig());

  const { startHttpServer } = require(requiredResources.httpServer);
  const { getToolSchemas } = require(path.join(resourcesPath, 'src', 'tools', 'schema.js'));
  const token = 'installed-smoke-token';
  const server = startHttpServer({
    host: '127.0.0.1',
    port: 0,
    token,
    exitOnError: false
  });

  try {
    await waitForListening(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Packaged HTTP server did not expose a TCP address.');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const healthResponse = await fetch(`${baseUrl}/health`);
    const health = await healthResponse.json();
    if (!healthResponse.ok || health?.ok !== true) throw new Error('Packaged /health endpoint failed.');

    const dashboardResponse = await fetch(`${baseUrl}/dashboard?token=${encodeURIComponent(token)}`);
    if (!dashboardResponse.ok) throw new Error(`Packaged dashboard returned HTTP ${dashboardResponse.status}.`);
    const dashboardHtml = await dashboardResponse.text();
    if (!dashboardHtml.includes('Rel.AI MCP Dashboard')) throw new Error('Packaged dashboard HTML is incomplete.');

    const toolsResponse = await fetch(`${baseUrl}/api/tools?token=${encodeURIComponent(token)}`);
    if (!toolsResponse.ok) throw new Error(`Packaged tools endpoint returned HTTP ${toolsResponse.status}.`);
    const tools = await toolsResponse.json();
    if (!Array.isArray(tools) || tools.length !== getToolSchemas().length) {
      throw new Error('Packaged tools endpoint does not match the tool registry.');
    }

    /** @type {InstalledSmokeResult} */
    const result = {
      ok: true,
      isPackaged: true,
      version: app.getVersion(),
      resourceChecks,
      health,
      dashboardStatus: dashboardResponse.status,
      publicToolCount: tools.length
    };
    writeResult(resultPath, result);
    return result;
  } finally {
    await closeServer(server);
  }
}

/** @param {unknown} error */
function writeInstalledSmokeFailure(error) {
  const resultPath = process.env.REL_AI_INSTALL_SMOKE_RESULT;
  if (!resultPath) return;
  writeResult(resultPath, {
    ok: false,
    error: formatUnknownError(error)
  });
}

function requiredResourcesPath() {
  const resourcesPath = /** @type {ElectronProcess} */ (process).resourcesPath;
  if (!resourcesPath) throw new Error('Electron resourcesPath is unavailable.');
  return resourcesPath;
}

/** @param {unknown} error @returns {string} */
function formatUnknownError(error) {
  if (error instanceof Error) return error.stack || error.message;
  if (typeof error === 'string') return error;
  if (error === null) return 'null';
  if (error === undefined) return 'undefined';
  try {
    const rendered = JSON.stringify(error);
    if (rendered) return rendered;
  } catch { /* fall through to a stable message */ }
  return 'Unknown error';
}

/** @param {string} name */
function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for installed smoke mode.`);
  return value;
}

/** @param {string} resultPath @param {unknown} value */
function writeResult(resultPath, value) {
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(resultPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** @param {any} server */
function waitForListening(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

/** @param {any} server */
function closeServer(server) {
  return new Promise((resolve) => {
    if (!server?.listening) return resolve(undefined);
    server.close(() => resolve(undefined));
  });
}

module.exports = { runInstalledSmoke, writeInstalledSmokeFailure };
