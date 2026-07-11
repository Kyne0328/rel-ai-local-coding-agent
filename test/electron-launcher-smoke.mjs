import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const utils = await import(pathToFileURL(path.join(root, 'electron', 'launcher-utils.js')).href);
const {
  buildTunnelCommand,
  buildMcpUrl,
  hasExistingConfig,
  normalizeNgrokDomain,
  normalizeNgrokAuthtoken,
  normalizePort,
  readGuiConfig
} = utils.default || utils;

assert.equal(normalizePort(3333), 3333);
assert.equal(normalizePort('4444'), 4444);
assert.throws(() => normalizePort(80), /between 1024 and 65535/);

assert.equal(normalizeNgrokDomain('https://My-Domain.ngrok-free.dev/'), 'my-domain.ngrok-free.dev');
assert.equal(normalizeNgrokAuthtoken('abc12345'), 'abc12345');
assert.throws(() => normalizeNgrokAuthtoken(''), /required/);
assert.throws(() => normalizeNgrokAuthtoken('abc 12345'), /spaces/);
assert.throws(() => normalizeNgrokDomain('example.com; rm -rf /'), /letters, numbers, dots, and hyphens|invalid/);
assert.throws(() => normalizeNgrokDomain('-bad.example.com'), /letters, numbers, dots, and hyphens|invalid DNS label/);

const tunnelCommand3333 = buildTunnelCommand('my-domain.ngrok-free.dev', 3333);
const tunnelCommand4444 = buildTunnelCommand('MY-DOMAIN.ngrok-free.dev', 4444);
assert.ok(tunnelCommand3333.includes('managed ngrok'));
assert.ok(tunnelCommand3333.includes('my-domain.ngrok-free.dev'));
assert.ok(tunnelCommand3333.includes('3333'));
assert.ok(tunnelCommand3333.includes('Rel.AI ngrok.yml'));
assert.ok(tunnelCommand4444.includes('my-domain.ngrok-free.dev'));
assert.ok(tunnelCommand4444.includes('4444'));

// Secret-in-URL is removed; ChatGPT uses Authentication: OAuth on the plain /mcp URL.
assert.equal(
  buildMcpUrl('https://my-domain.ngrok-free.dev'),
  'https://my-domain.ngrok-free.dev/mcp'
);
assert.equal(
  buildMcpUrl('https://my-domain.ngrok-free.dev/'),
  'https://my-domain.ngrok-free.dev/mcp'
);

const electronPkg = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'package.json'), 'utf8'));
const srcResource = electronPkg.build.extraResources.find((item) => item.from === '../src');
assert.ok(srcResource, 'electron build must bundle src resources');
assert.ok(srcResource.filter.includes('**/*.js'), 'electron build must bundle src JavaScript');
assert.ok(srcResource.filter.includes('**/*.css'), 'electron build must bundle src UI CSS imported by public/dashboard.css');
assert.ok(electronPkg.build.files.includes('managed-ngrok.js'), 'electron build must include managed ngrok launcher code');
assert.ok(electronPkg.build.files.includes('window-smoke.js'), 'electron build must include packaged renderer smoke coverage');
assert.ok(electronPkg.build.files.includes('tool-sleep-blocker.js'), 'electron build must include tool-call sleep prevention');
assert.ok(electronPkg.build.extraResources.some((item) => item.from === '../vendor/ngrok'), 'electron build must bundle ngrok seed binaries');

const electronMain = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
assert.match(
  electronMain,
  /const \{ fitWindowToContent, WINDOW_SIZE_LIMITS \} = require\('\.\/window-size'\);/,
  'Electron main must import the window limits used by normal wizard and status startup'
);
assert.match(electronMain, /powerSaveBlocker/, 'Electron main must use the native sleep-prevention API');
assert.match(electronMain, /bindToolActivitySleep/, 'Electron main must bind connector activity to native sleep prevention');
assert.match(electronMain, /stopToolSleepBinding\(\)/, 'sleep prevention must stop during application shutdown');

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-gui-test-'));
process.env.REL_AI_MCP_STATE_DIR = stateDir;

assert.equal(hasExistingConfig(), false);

fs.writeFileSync(path.join(stateDir, 'connection.json'), JSON.stringify({ port: 3333 }));
assert.equal(hasExistingConfig(), false);

fs.writeFileSync(
  path.join(stateDir, '.env'),
  'REL_AI_MCP_NGROK_DOMAIN="my-domain.ngrok-free.dev"\nREL_AI_MCP_NGROK_AUTHTOKEN="abc12345"\nREL_AI_MCP_TOKEN="token"\n'
);
assert.equal(hasExistingConfig(), true);
assert.deepEqual(
  { port: readGuiConfig().port, ngrokDomain: readGuiConfig().ngrokDomain, ngrokAuthtoken: readGuiConfig().ngrokAuthtoken, token: readGuiConfig().token },
  { port: 3333, ngrokDomain: 'my-domain.ngrok-free.dev', ngrokAuthtoken: 'abc12345', token: 'token' }
);

fs.writeFileSync(path.join(stateDir, 'connection.json'), JSON.stringify({}));
assert.equal(hasExistingConfig(), false);

console.log('electron-launcher-smoke passed.');
