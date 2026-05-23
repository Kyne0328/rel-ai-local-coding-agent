import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const utils = await import(path.join(root, 'electron', 'launcher-utils.js'));
const {
  buildTunnelCommand,
  buildMcpUrl,
  hasExistingConfig,
  normalizeNgrokDomain,
  normalizePort,
  readGuiConfig
} = utils.default || utils;

assert.equal(normalizePort(3333), 3333);
assert.equal(normalizePort('4444'), 4444);
assert.throws(() => normalizePort(80), /between 1024 and 65535/);

assert.equal(normalizeNgrokDomain('https://My-Domain.ngrok-free.dev/'), 'my-domain.ngrok-free.dev');
assert.throws(() => normalizeNgrokDomain('example.com; rm -rf /'), /letters, numbers, dots, and hyphens|invalid/);
assert.throws(() => normalizeNgrokDomain('-bad.example.com'), /letters, numbers, dots, and hyphens|invalid DNS label/);

assert.equal(
  buildTunnelCommand('my-domain.ngrok-free.dev', 3333),
  'ngrok http --url=my-domain.ngrok-free.dev 3333 --log=stdout'
);
assert.equal(
  buildTunnelCommand('MY-DOMAIN.ngrok-free.dev', 4444),
  'ngrok http --url=my-domain.ngrok-free.dev 4444 --log=stdout'
);

assert.equal(
  buildMcpUrl('https://my-domain.ngrok-free.dev', 'abc123'),
  'https://my-domain.ngrok-free.dev/mcp/abc123'
);
assert.equal(
  buildMcpUrl('https://my-domain.ngrok-free.dev/', 'has space'),
  'https://my-domain.ngrok-free.dev/mcp/has%20space'
);

const electronPkg = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'package.json'), 'utf8'));
const srcResource = electronPkg.build.extraResources.find((item) => item.from === '../src');
assert.ok(srcResource, 'electron build must bundle src resources');
assert.ok(srcResource.filter.includes('**/*.js'), 'electron build must bundle src JavaScript');
assert.ok(srcResource.filter.includes('**/*.css'), 'electron build must bundle src UI CSS imported by public/dashboard.css');

const dashboardJs = fs.readFileSync(path.join(root, 'public', 'dashboard.js'), 'utf8');
assert.ok(
  dashboardJs.includes('const workspaceList = storeData.config && Array.isArray(storeData.config.workspaces) ? storeData.config.workspaces : [];'),
  'dashboard boot must normalize workspace actions before calling map'
);
assert.ok(
  !dashboardJs.includes('Array.isArray(storeData.config && storeData.config.workspaces ? storeData.config.workspaces : []).map'),
  'dashboard boot must not call .map on the boolean returned by Array.isArray'
);

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-gui-test-'));
process.env.REL_AI_MCP_STATE_DIR = stateDir;

assert.equal(hasExistingConfig(), false);

fs.writeFileSync(path.join(stateDir, 'connection.json'), JSON.stringify({ port: 3333 }));
assert.equal(hasExistingConfig(), false);

fs.writeFileSync(
  path.join(stateDir, '.env'),
  'REL_AI_MCP_NGROK_DOMAIN="my-domain.ngrok-free.dev"\nREL_AI_MCP_TOKEN="token"\n'
);
assert.equal(hasExistingConfig(), true);
assert.deepEqual(
  { port: readGuiConfig().port, ngrokDomain: readGuiConfig().ngrokDomain, token: readGuiConfig().token },
  { port: 3333, ngrokDomain: 'my-domain.ngrok-free.dev', token: 'token' }
);

fs.writeFileSync(path.join(stateDir, 'connection.json'), JSON.stringify({}));
assert.equal(hasExistingConfig(), false);

console.log('electron-launcher-smoke passed.');
