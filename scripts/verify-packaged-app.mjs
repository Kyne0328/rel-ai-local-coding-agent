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

const tunnelClientRelativePath = `resources/bin/tunnel-client/${spec.tunnelClientDirectory}/${spec.tunnelClientFile}`;
const sourceZoektManifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'zoekt', 'manifest.json'), 'utf8'));
const sourceTreeSitterManifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'tree-sitter', 'manifest.json'), 'utf8'));
const sourceZoektSpec = sourceZoektManifest.platforms?.[platform];
assert.ok(sourceZoektSpec, `Zoekt provenance manifest does not support ${platform}.`);
const zoektSearchRelativePath = `resources/bin/zoekt/${platform}/${sourceZoektSpec.search.file}`;
const zoektIndexRelativePath = `resources/bin/zoekt/${platform}/${sourceZoektSpec.index.file}`;
const requiredFiles = [
  spec.executableName,
  'resources/app.asar',
  'resources/src/httpServer.js',
  'resources/src/tools/actionCatalog.js',
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
  'resources/node_modules/web-tree-sitter/package.json',
  'resources/node_modules/web-tree-sitter/tree-sitter.js',
  'resources/node_modules/web-tree-sitter/tree-sitter.wasm',
  'resources/node_modules/tree-sitter-wasms/package.json',
  'resources/node_modules/tree-sitter-wasms/out/tree-sitter-javascript.wasm',
  'resources/vendor/tree-sitter/manifest.json',
  'resources/bin/rel-ai-mcp-http.js',
  'resources/public/dashboard.js',
  'resources/public/dashboard.css',
  'resources/package.json',
  'resources/CHANGELOG.md',
  'resources/LICENSE',
  'resources/NOTICE',
  'resources/bin/tunnel-client/manifest.json',
  tunnelClientRelativePath,
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
assertExecutable(path.join(packageDirectory, tunnelClientRelativePath), platform);
assertExecutable(path.join(packageDirectory, zoektSearchRelativePath), platform);
assertExecutable(path.join(packageDirectory, zoektIndexRelativePath), platform);

const asarPath = path.join(packageDirectory, 'resources', 'app.asar');
const asarEntries = new Set(listPackage(asarPath).map(entry => entry.replaceAll('\\', '/').replace(/^\//, '')));
for (const relativePath of ['preload.cjs', 'startup-background.js', 'secure-tunnel-runtime.js', 'tunnel-credentials.js', 'renderer/app.css', 'renderer/color-tokens.css', 'renderer/status.html', 'renderer/wizard.html']) {
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
const packagedTreeSitterManifest = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'resources', 'vendor', 'tree-sitter', 'manifest.json'), 'utf8'));
assert.deepEqual(packagedTreeSitterManifest, sourceTreeSitterManifest, 'Packaged vendored Tree-sitter manifest must match the reviewed source manifest.');
for (const grammar of Object.values(sourceTreeSitterManifest.grammars || {})) {
  const sourceFile = path.join(root, 'vendor', 'tree-sitter', grammar.file);
  const packagedFile = path.join(packageDirectory, 'resources', 'vendor', 'tree-sitter', grammar.file);
  assert.ok(fs.existsSync(sourceFile), `Vendored Tree-sitter source grammar is missing: ${grammar.file}`);
  assert.ok(fs.existsSync(packagedFile), `Packaged vendored Tree-sitter grammar is missing: ${grammar.file}`);
  const sourceBytes = fs.readFileSync(sourceFile);
  const packagedBytes = fs.readFileSync(packagedFile);
  assert.equal(sourceBytes.length, Number(grammar.bytes), `Vendored Tree-sitter grammar size mismatch: ${grammar.file}`);
  assert.equal(packagedBytes.length, Number(grammar.bytes), `Packaged vendored Tree-sitter grammar size mismatch: ${grammar.file}`);
  assert.equal(crypto.createHash('sha256').update(sourceBytes).digest('hex'), grammar.sha256, `Vendored Tree-sitter grammar checksum mismatch: ${grammar.file}`);
  assert.equal(crypto.createHash('sha256').update(packagedBytes).digest('hex'), grammar.sha256, `Packaged vendored Tree-sitter grammar checksum mismatch: ${grammar.file}`);
}
const tunnelManifest = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'resources', 'bin', 'tunnel-client', 'manifest.json'), 'utf8'));
const tunnelSpec = tunnelManifest.platforms[platform];
assert.ok(tunnelSpec, `Packaged OpenAI tunnel-client manifest does not support ${platform}.`);
const packagedTunnelClient = fs.readFileSync(path.join(packageDirectory, tunnelClientRelativePath));
assert.equal(packagedTunnelClient.length, tunnelSpec.size, 'Packaged OpenAI tunnel-client size does not match the provenance manifest.');
assert.equal(crypto.createHash('sha256').update(packagedTunnelClient).digest('hex'), tunnelSpec.sha256, 'Packaged OpenAI tunnel-client SHA-256 does not match the provenance manifest.');
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

const forbiddenLegacyTransportPaths = [
  'resources/bin/ngrok',
  'resources/gateway',
  'resources/node_modules/wrangler',
  'resources/node_modules/@cloudflare',
  'resources/node_modules/miniflare'
];
for (const relativePath of forbiddenLegacyTransportPaths) {
  assert.equal(fs.existsSync(path.join(packageDirectory, relativePath)), false, `Packaged desktop must exclude obsolete transport path: ${relativePath}`);
}
const packagedFiles = collectFiles(packageDirectory);
for (const sensitiveName of ['privateJwk', 'recoverySecret']) {
  assert.equal(packagedFiles.some(file => file.toLowerCase().includes(sensitiveName.toLowerCase())), false, `Packaged desktop must not contain secret-state file names matching ${sensitiveName}.`);
}
assert.equal(fs.existsSync(path.join(packageDirectory, 'resources', '.env')), false, 'Runtime credentials must not be materialized in the packaged application.');

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
