import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listPackage } from '@electron/asar';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { electronPlatformSpec, normalizeElectronPlatform } from './electron-platform.mjs';
import { resolvePackagedDirectory } from './packaged-directory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const platform = normalizeElectronPlatform(valueAfter(argv, '--platform', process.platform));
const spec = electronPlatformSpec(platform);
const packageDirectory = resolvePackagedDirectory(root, argv, { platform });

assert.ok(fs.existsSync(packageDirectory), `Packaged application directory does not exist: ${packageDirectory}`);
assert.ok(fs.statSync(packageDirectory).isDirectory(), `Packaged application path is not a directory: ${packageDirectory}`);

const fusesEntry = path.join(root, 'electron', 'node_modules', '@electron', 'fuses', 'dist', 'index.js');
assert.ok(fs.existsSync(fusesEntry), `Electron fuse inspector is missing: ${fusesEntry}`);
const { getCurrentFuseWire, FuseV1Options } = await import(pathToFileURL(fusesEntry).href);
const executablePath = path.join(packageDirectory, spec.executableName);
assert.ok(fs.existsSync(executablePath), `Packaged application executable does not exist: ${executablePath}`);
assertExecutable(executablePath, platform);
const fuseWire = await getCurrentFuseWire(executablePath);
const browserSpecificSnapshotEnabled = Number(fuseWire[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]) === 49;
if (browserSpecificSnapshotEnabled) {
  const browserSnapshot = path.join(packageDirectory, 'browser_v8_context_snapshot.bin');
  assert.ok(fs.existsSync(browserSnapshot), 'LoadBrowserProcessSpecificV8Snapshot is enabled, but browser_v8_context_snapshot.bin is missing.');
  assert.ok(fs.statSync(browserSnapshot).isFile() && fs.statSync(browserSnapshot).size > 0, 'browser_v8_context_snapshot.bin must be a non-empty file when its fuse is enabled.');
}

const ngrokRelativePath = `resources/bin/ngrok/${spec.ngrokDirectory}/${spec.ngrokFile}`;
const sourceZoektManifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'zoekt', 'manifest.json'), 'utf8'));
const sourceZoektSpec = sourceZoektManifest.platforms?.[platform];
assert.ok(sourceZoektSpec, `Zoekt provenance manifest does not support ${platform}.`);
const zoektSearchRelativePath = `resources/bin/zoekt/${platform}/${sourceZoektSpec.search.file}`;
const zoektIndexRelativePath = `resources/bin/zoekt/${platform}/${sourceZoektSpec.index.file}`;
const requiredFiles = [
  spec.executableName,
  'resources/app.asar',
  'resources/src/httpServer.js',
  'resources/public/oauth.css',
  'resources/src/tools/actionCatalog.js',
  'resources/src/config.js',
  'resources/src/mcpServer.js',
  'resources/src/gateway/localExecution.js',
  'resources/src/gateway/protocol.js',
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
  'resources/node_modules/web-tree-sitter/package.json',
  'resources/node_modules/web-tree-sitter/tree-sitter.js',
  'resources/node_modules/web-tree-sitter/tree-sitter.wasm',
  'resources/node_modules/tree-sitter-wasms/package.json',
  'resources/node_modules/tree-sitter-wasms/out/tree-sitter-javascript.wasm',
  'resources/bin/rel-ai-mcp-http.js',
  'resources/public/dashboard.js',
  'resources/package.json',
  'resources/CHANGELOG.md',
  'resources/LICENSE',
  'resources/NOTICE',
  'resources/bin/ngrok/manifest.json',
  ngrokRelativePath,
  'resources/bin/zoekt/manifest.json',
  'resources/bin/zoekt/LICENSE',
  zoektSearchRelativePath,
  zoektIndexRelativePath
];

for (const relativePath of requiredFiles) {
  const file = path.join(packageDirectory, relativePath);
  assert.ok(fs.existsSync(file), `Packaged application is missing: ${relativePath}`);
  assert.ok(fs.statSync(file).isFile(), `Packaged application entry is not a file: ${relativePath}`);
  assert.ok(fs.statSync(file).size > 0, `Packaged application file is empty: ${relativePath}`);
}
assertExecutable(path.join(packageDirectory, ngrokRelativePath), platform);
assertExecutable(path.join(packageDirectory, zoektSearchRelativePath), platform);
assertExecutable(path.join(packageDirectory, zoektIndexRelativePath), platform);

const asarPath = path.join(packageDirectory, 'resources', 'app.asar');
const asarEntries = new Set(listPackage(asarPath).map(entry => entry.replaceAll('\\', '/').replace(/^\//, '')));
for (const relativePath of ['preload.cjs', 'startup-background.js', 'gateway-client.js', 'gateway-device-identity.js', 'gateway-state.js', 'public-connection-runtime.js', 'renderer/app.css', 'renderer/color-tokens.css', 'renderer/status.html', 'renderer/wizard.html']) {
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
const rootTreeSitterWasms = fs.readdirSync(path.join(root, 'node_modules', 'tree-sitter-wasms', 'out'))
  .filter(name => name.endsWith('.wasm'))
  .sort();
const packagedTreeSitterWasms = fs.readdirSync(path.join(packageDirectory, 'resources', 'node_modules', 'tree-sitter-wasms', 'out'))
  .filter(name => name.endsWith('.wasm'))
  .sort();
assert.deepEqual(packagedTreeSitterWasms, rootTreeSitterWasms, 'Packaged application must include every Tree-sitter WASM grammar shipped by the root runtime dependency.');
const ngrokManifest = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'resources', 'bin', 'ngrok', 'manifest.json'), 'utf8'));
const ngrokSpec = ngrokManifest.platforms[platform];
assert.ok(ngrokSpec, `Packaged ngrok manifest does not support ${platform}.`);
const packagedNgrok = fs.readFileSync(path.join(packageDirectory, ngrokRelativePath));
assert.equal(packagedNgrok.length, ngrokSpec.size, 'Packaged ngrok size does not match the provenance manifest.');
assert.equal(crypto.createHash('sha256').update(packagedNgrok).digest('hex'), ngrokSpec.sha256, 'Packaged ngrok SHA-256 does not match the provenance manifest.');
const packagedZoektManifest = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'resources', 'bin', 'zoekt', 'manifest.json'), 'utf8'));
assert.deepEqual(packagedZoektManifest, sourceZoektManifest, 'Packaged Zoekt provenance manifest must match the reviewed source manifest.');
for (const [key, relativePath] of [['search', zoektSearchRelativePath], ['index', zoektIndexRelativePath]]) {
  const artifact = sourceZoektSpec[key];
  const binaryPath = path.join(packageDirectory, relativePath);
  const bytes = fs.readFileSync(binaryPath);
  assert.equal(bytes.length, Number(artifact.size), `Packaged Zoekt ${key} size does not match provenance.`);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), artifact.sha256, `Packaged Zoekt ${key} SHA-256 does not match provenance.`);
  const help = spawnSync(binaryPath, ['-h'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(help.status, 0, `Packaged Zoekt ${key} binary must execute successfully.`);
}
const packagedTypeScript = collectFiles(path.join(packageDirectory, 'resources', 'node_modules')).filter(file => /\.(?:ts|cts|mts)$/i.test(file));
assert.deepEqual(packagedTypeScript, [], 'Packaged runtime dependencies must exclude TypeScript sources and declarations.');

const forbiddenGatewayRuntimePaths = [
  'resources/gateway',
  'resources/gateway/node_modules',
  'resources/node_modules/wrangler',
  'resources/node_modules/@cloudflare',
  'resources/node_modules/miniflare'
];
for (const relativePath of forbiddenGatewayRuntimePaths) {
  assert.equal(fs.existsSync(path.join(packageDirectory, relativePath)), false, `Packaged desktop must exclude gateway Worker/tooling path: ${relativePath}`);
}
const packagedFiles = collectFiles(packageDirectory);
for (const sensitiveName of ['privateJwk', 'recoverySecret']) {
  assert.equal(packagedFiles.some(file => file.toLowerCase().includes(sensitiveName.toLowerCase())), false, `Packaged desktop must not contain secret-state file names matching ${sensitiveName}.`);
}
assert.equal(fs.existsSync(path.join(packageDirectory, 'resources', '.env')), false, 'REL_AI_GATEWAY_ORIGIN and other runtime configuration must not be materialized in a packaged .env file.');

function collectFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(target));
    else if (entry.isFile()) files.push(path.relative(packageDirectory, target).replaceAll('\\', '/'));
  }
  return files;
}

function valueAfter(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function assertExecutable(file, targetPlatform) {
  if (targetPlatform !== 'linux') return;
  assert.notEqual(fs.statSync(file).mode & 0o111, 0, `Linux packaged executable lacks execute permissions: ${file}`);
}

console.log(`Packaged ${platform} application layout verified for v${packagedPackage.version}: ${requiredFiles.length} required files are present.`);
