import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { listPackage } from '@electron/asar';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolvePackagedDirectory } from './packaged-directory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectory = resolvePackagedDirectory(root, process.argv.slice(2));

assert.ok(fs.existsSync(packageDirectory), `Packaged application directory does not exist: ${packageDirectory}`);
assert.ok(fs.statSync(packageDirectory).isDirectory(), `Packaged application path is not a directory: ${packageDirectory}`);

const fusesEntry = path.join(root, 'electron', 'node_modules', '@electron', 'fuses', 'dist', 'index.js');
assert.ok(fs.existsSync(fusesEntry), `Electron fuse inspector is missing: ${fusesEntry}`);
const { getCurrentFuseWire, FuseV1Options } = await import(pathToFileURL(fusesEntry).href);
const executablePath = path.join(packageDirectory, 'Rel.AI MCP.exe');
assert.ok(fs.existsSync(executablePath), `Packaged application executable does not exist: ${executablePath}`);
const fuseWire = await getCurrentFuseWire(executablePath);
const browserSpecificSnapshotEnabled = Number(fuseWire[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]) === 49;
if (browserSpecificSnapshotEnabled) {
  const browserSnapshot = path.join(packageDirectory, 'browser_v8_context_snapshot.bin');
  assert.ok(fs.existsSync(browserSnapshot), 'LoadBrowserProcessSpecificV8Snapshot is enabled, but browser_v8_context_snapshot.bin is missing.');
  assert.ok(fs.statSync(browserSnapshot).isFile() && fs.statSync(browserSnapshot).size > 0, 'browser_v8_context_snapshot.bin must be a non-empty file when its fuse is enabled.');
}

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
  'resources/node_modules/@opentelemetry/api/package.json',
  'resources/node_modules/@opentelemetry/exporter-trace-otlp-http/package.json',
  'resources/node_modules/@opentelemetry/resources/package.json',
  'resources/node_modules/@opentelemetry/sdk-trace-node/package.json',
  'resources/node_modules/@opentelemetry/semantic-conventions/package.json',
  'resources/node_modules/@hono/node-server/package.json',
  'resources/node_modules/hono/package.json',
  'resources/node_modules/zod/package.json',
  'resources/bin/rel-ai-mcp-http.js',
  'resources/public/dashboard.js',
  'resources/package.json',
  'resources/CHANGELOG.md',
  'resources/bin/ngrok/manifest.json'
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
const rootOpenTelemetryDirectory = path.join(root, 'node_modules', '@opentelemetry');
const packagedOpenTelemetryDirectory = path.join(packageDirectory, 'resources', 'node_modules', '@opentelemetry');
const rootOpenTelemetryPackages = fs.readdirSync(rootOpenTelemetryDirectory, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();
const packagedOpenTelemetryPackages = fs.readdirSync(packagedOpenTelemetryDirectory, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();
assert.deepEqual(packagedOpenTelemetryPackages, rootOpenTelemetryPackages, 'Packaged application must include the complete OpenTelemetry runtime dependency scope.');
const ngrokManifest = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'resources', 'bin', 'ngrok', 'manifest.json'), 'utf8'));
const ngrokSpec = ngrokManifest.platforms.win32;
assert.equal(ngrokManifest.schemaVersion, 2, 'Packaged ngrok acquisition manifest must use schema v2.');
assert.equal(ngrokManifest.delivery, 'verified-first-run-download', 'Packaged ngrok delivery policy must require verified first-run acquisition.');
assert.equal(ngrokSpec.executable.file, 'ngrok.exe', 'Packaged ngrok manifest must identify the managed executable.');
assert.match(ngrokSpec.archive.url, /^https:\/\/bin\.ngrok\.com\//, 'Packaged ngrok archive URL must use the reviewed distribution host.');
assert.equal(fs.existsSync(path.join(packageDirectory, 'resources', 'bin', 'ngrok', 'win32', 'ngrok.exe')), false, 'The application package must not embed ngrok.exe.');
assert.equal(fs.existsSync(path.join(packageDirectory, 'resources', 'src', 'ui', 'styles', 'app.css')), false, 'Compiled dashboard CSS must be packaged without the source Tailwind stylesheet.');
const packagedTypeScript = collectFiles(path.join(packageDirectory, 'resources', 'node_modules')).filter(file => /\.(?:ts|cts|mts)$/i.test(file));
assert.deepEqual(packagedTypeScript, [], 'Packaged runtime dependencies must exclude TypeScript sources and declarations.');

function collectFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(target));
    else if (entry.isFile()) files.push(path.relative(packageDirectory, target).replaceAll('\\', '/'));
  }
  return files;
}

console.log(`Packaged application layout verified for v${packagedPackage.version}: ${requiredFiles.length} required files are present.`);
