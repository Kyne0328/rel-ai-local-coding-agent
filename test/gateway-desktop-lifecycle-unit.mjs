import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-gateway-desktop-lifecycle-'));
const previousStateDir = process.env.REL_AI_MCP_STATE_DIR;
const previousConfig = process.env.REL_AI_MCP_CONFIG;
const previousGatewayOrigin = process.env.REL_AI_GATEWAY_ORIGIN;
process.env.REL_AI_MCP_STATE_DIR = stateDir;
process.env.REL_AI_MCP_CONFIG = path.join(stateDir, 'config.json');

const {
  DEFAULT_GATEWAY_ORIGIN,
  hasExistingConfig,
  normalizeConnectionMode,
  normalizeGatewayOrigin,
  readGuiConfig
} = await import('../electron/launcher-utils.js');
const { normalizeWizardConfig, saveLauncherConfig } = await import('../electron/launcher-config.js');
const { safeGatewayDesktopStatus } = await import('../electron/desktop-status.js');
const { createPublicConnectionRuntime } = await import('../electron/public-connection-runtime.js');

try {
  assert.equal(normalizeConnectionMode('', {}), 'cloud');
  assert.equal(normalizeConnectionMode('', { ngrokDomain: 'legacy.ngrok-free.dev', ngrokAuthtoken: 'abc12345' }), 'direct');
  assert.equal(normalizeConnectionMode('cloud', { ngrokDomain: 'legacy.ngrok-free.dev', ngrokAuthtoken: 'abc12345' }), 'cloud');
  assert.equal(normalizeConnectionMode('direct', {}), 'direct');
  assert.throws(() => normalizeConnectionMode('other', {}), /cloud or direct/);

  assert.equal(normalizeGatewayOrigin(''), DEFAULT_GATEWAY_ORIGIN);
  assert.equal(normalizeGatewayOrigin('https://gateway.example.test/path'), 'https://gateway.example.test');
  assert.equal(normalizeGatewayOrigin('http://127.0.0.1:8787/path'), 'http://127.0.0.1:8787');
  assert.throws(() => normalizeGatewayOrigin('http://gateway.example.test'), /HTTPS/);

  assert.equal(normalizeWizardConfig({ port: 3333, token: 'fresh-token' }).connectionMode, 'cloud');
  const cloudIgnoresStaleDirect = normalizeWizardConfig({
    connectionMode: 'cloud',
    port: 3333,
    token: 'fresh-token',
    ngrokDomain: 'not a valid domain',
    ngrokAuthtoken: 'not a valid account key'
  });
  assert.equal(cloudIgnoresStaleDirect.connectionMode, 'cloud');
  assert.equal(cloudIgnoresStaleDirect.ngrokDomain, 'not a valid domain');
  assert.throws(() => normalizeWizardConfig({
    connectionMode: 'direct',
    port: 3333,
    token: 'direct-token',
    ngrokDomain: 'not a valid domain',
    ngrokAuthtoken: 'not a valid account key'
  }), /include a dot|letters, numbers|spaces|invalid/);
  assert.equal(hasExistingConfig(), false);

  const cloud = saveLauncherConfig({
    connectionMode: 'cloud',
    gatewayOrigin: 'https://gateway.example.test',
    port: 3333,
    token: 'cloud-token'
  });
  assert.equal(cloud.connectionMode, 'cloud');
  assert.equal(hasExistingConfig(), true);
  assert.deepEqual(readGuiConfig(), {
    connectionMode: 'cloud',
    gatewayOrigin: 'https://gateway.example.test',
    port: 3333,
    ngrokDomain: '',
    token: 'cloud-token',
    ngrokAuthtoken: '',
    publicUrl: ''
  });
  assert.doesNotMatch(fs.readFileSync(path.join(stateDir, '.env'), 'utf8'), /REL_AI_GATEWAY_ORIGIN/, 'the public gateway URL must not be persisted in the private launch environment');

  assert.throws(() => saveLauncherConfig({ connectionMode: 'direct', port: 3333, token: 'direct-token' }), /ngrok domain is required/);
  const direct = saveLauncherConfig({
    connectionMode: 'direct',
    port: 4444,
    token: 'direct-token',
    ngrokDomain: 'direct.ngrok-free.dev',
    ngrokAuthtoken: 'abc12345'
  });
  assert.equal(direct.connectionMode, 'direct');
  assert.equal(readGuiConfig().connectionMode, 'direct');
  assert.equal(readGuiConfig().publicUrl, 'https://direct.ngrok-free.dev');

  saveLauncherConfig({
    connectionMode: 'cloud',
    gatewayOrigin: 'https://gateway.example.test',
    port: 4444,
    token: 'cloud-again'
  });
  const switchedCloud = readGuiConfig();
  assert.equal(switchedCloud.connectionMode, 'cloud');
  assert.equal(switchedCloud.publicUrl, '', 'cloud mode must not expose a stale direct public URL');
  assert.equal(switchedCloud.ngrokDomain, 'direct.ngrok-free.dev', 'direct credentials must remain available for an explicit fallback');
  assert.equal(switchedCloud.ngrokAuthtoken, 'abc12345');

  const safeStatus = safeGatewayDesktopStatus({
    state: 'pairing',
    principalPaired: false,
    principalId: 'prn_secret',
    recoverySecret: 'recovery_secret',
    pollToken: 'poll_secret',
    deviceId: '11111111-1111-4111-8111-111111111111',
    pairing: { pairingId: 'pair_123', code: 'ABCD-EFGH-JKLM', expiresAt: 12345, pollToken: 'poll_secret' },
    reconnectAttempt: 2
  }, 'https://gateway.example.test');
  assert.equal(safeStatus.principalId, undefined);
  assert.equal(safeStatus.recoverySecret, undefined);
  assert.equal(safeStatus.pollToken, undefined);
  assert.equal(safeStatus.pairing.pollToken, undefined);
  assert.equal(safeStatus.pairing.code, 'ABCD-EFGH-JKLM');

  fs.writeFileSync(path.join(stateDir, '.env'), [
    'REL_AI_MCP_PORT="4555"',
    'REL_AI_MCP_TOKEN="legacy-token"',
    'REL_AI_MCP_NGROK_DOMAIN="legacy.ngrok-free.dev"',
    'REL_AI_MCP_NGROK_AUTHTOKEN="abc12345"',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(stateDir, 'connection.json'), JSON.stringify({ port: 4555, ngrokDomain: 'legacy.ngrok-free.dev' }));
  const legacy = readGuiConfig();
  assert.equal(legacy.connectionMode, 'direct', 'legacy managed-ngrok installs must migrate to direct mode');
  assert.equal(legacy.gatewayOrigin, DEFAULT_GATEWAY_ORIGIN);
  assert.equal(hasExistingConfig(), true);

  let gatewayCreated = 0;
  let gatewayStarted = 0;
  let gatewayStopped = 0;
  let ngrokPrepared = 0;
  let ngrokStarted = 0;
  let ngrokStopped = 0;
  let localServerStarts = 1;
  let dashboardStarts = 1;
  let gatewayStatusCallback = null;

  const runtime = createPublicConnectionRuntime({
    createGatewayConnection({ onStatus }) {
      gatewayCreated += 1;
      gatewayStatusCallback = onStatus;
      return {
        async start() { gatewayStarted += 1; return { state: 'connecting', principalPaired: true }; },
        async stop() { gatewayStopped += 1; return { state: 'offline' }; }
      };
    },
    async prepareDirect() { ngrokPrepared += 1; },
    async startDirect() { ngrokStarted += 1; return { ok: true, process: { pid: 123 }, publicUrl: 'https://direct.ngrok-free.dev' }; },
    async stopDirect() { ngrokStopped += 1; return { exited: true, forced: false }; }
  });

  const cloudRuntime = await runtime.start({ connectionMode: 'cloud', gatewayOrigin: 'https://gateway.example.test', port: 3333 });
  assert.equal(cloudRuntime.mode, 'cloud');
  assert.equal(gatewayCreated, 1);
  assert.equal(gatewayStarted, 1);
  assert.equal(ngrokPrepared, 0);
  assert.equal(ngrokStarted, 0);

  gatewayStatusCallback({ state: 'offline', reconnectAttempt: 1, principalPaired: true });
  gatewayStatusCallback({ state: 'connecting', reconnectAttempt: 1, principalPaired: true });
  gatewayStatusCallback({ state: 'connected', reconnectAttempt: 0, principalPaired: true });
  assert.equal(localServerStarts, 1, 'gateway reconnect must not restart the local server');
  assert.equal(dashboardStarts, 1, 'gateway reconnect must not recreate the dashboard');

  const stoppedCloud = await runtime.stop();
  assert.equal(stoppedCloud.mode, 'cloud');
  assert.equal(gatewayStopped, 1);
  assert.equal(ngrokStopped, 0);

  const directRuntime = await runtime.start({
    connectionMode: 'direct',
    port: 4444,
    ngrokDomain: 'direct.ngrok-free.dev',
    ngrokAuthtoken: 'abc12345'
  });
  assert.equal(directRuntime.mode, 'direct');
  assert.equal(ngrokPrepared, 1);
  assert.equal(ngrokStarted, 1);
  assert.equal(gatewayCreated, 1, 'direct mode must not create a gateway client');
  const stoppedDirect = await runtime.stop();
  assert.equal(stoppedDirect.mode, 'direct');
  assert.equal(ngrokStopped, 1);
} finally {
  if (previousStateDir === undefined) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  if (previousConfig === undefined) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  if (previousGatewayOrigin === undefined) delete process.env.REL_AI_GATEWAY_ORIGIN;
  else process.env.REL_AI_GATEWAY_ORIGIN = previousGatewayOrigin;
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('Gateway desktop connection-mode migration and lifecycle tests passed.');
