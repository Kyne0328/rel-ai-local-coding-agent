import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { listPackage } from '@electron/asar';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dirIndex = args.indexOf('--dir');
const requestedDirectory = dirIndex >= 0 ? args[dirIndex + 1] : '';
const packageDirectory = path.resolve(requestedDirectory || path.join(root, 'dist', 'build-check', 'win-unpacked'));

assert.ok(fs.existsSync(packageDirectory), `Packaged application directory does not exist: ${packageDirectory}`);
assert.ok(fs.statSync(packageDirectory).isDirectory(), `Packaged application path is not a directory: ${packageDirectory}`);

const requiredFiles = [
  'Rel.AI MCP.exe',
  'resources/app.asar',
  'resources/src/httpServer.js',
  'resources/public/oauth.css',
  'resources/src/tools/registry.js',
  'resources/src/config.js',
  'resources/src/mcpServer.js',
  'resources/node_modules/@modelcontextprotocol/server/package.json',
  'resources/node_modules/@modelcontextprotocol/node/package.json',
  'resources/node_modules/@modelcontextprotocol/core/package.json',
  'resources/node_modules/@hono/node-server/package.json',
  'resources/node_modules/hono/package.json',
  'resources/node_modules/zod/package.json',
  'resources/bin/rel-ai-mcp-http.js',
  'resources/public/dashboard.js',
  'resources/package.json',
  'resources/CHANGELOG.md',
  'resources/bin/ngrok/win32/ngrok.exe'
];

for (const relativePath of requiredFiles) {
  const file = path.join(packageDirectory, relativePath);
  assert.ok(fs.existsSync(file), `Packaged application is missing: ${relativePath}`);
  assert.ok(fs.statSync(file).isFile(), `Packaged application entry is not a file: ${relativePath}`);
  assert.ok(fs.statSync(file).size > 0, `Packaged application file is empty: ${relativePath}`);
}

const asarPath = path.join(packageDirectory, 'resources', 'app.asar');
const asarEntries = new Set(listPackage(asarPath).map(entry => entry.replaceAll('\\', '/').replace(/^\//, '')));
for (const relativePath of ['preload.cjs', 'startup-background.js', 'renderer/app.css', 'renderer/color-tokens.css', 'renderer/status.html', 'renderer/wizard.html']) {
  assert.ok(asarEntries.has(relativePath), `Packaged ASAR is missing: ${relativePath}`);
}

const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packagedPackage = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'resources', 'package.json'), 'utf8'));
assert.equal(packagedPackage.name, rootPackage.name, 'Packaged package metadata has the wrong product name.');
assert.equal(packagedPackage.version, rootPackage.version, 'Packaged package metadata has the wrong version.');
assert.equal(fs.existsSync(path.join(packageDirectory, 'resources', 'src', 'ui', 'styles', 'app.css')), false, 'Compiled dashboard CSS must be packaged without the source Tailwind stylesheet.');

console.log(`Packaged application layout verified for v${packagedPackage.version}: ${requiredFiles.length} required files are present.`);
