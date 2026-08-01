import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.REL_AI_RELEASE_ROOT || path.join(__dirname, '..'));
const failures = [];
const ESCAPED_DOT = String.raw`\.`;

function rel(...parts) {
  return path.join(root, ...parts);
}

function read(relativePath) {
  return fs.readFileSync(rel(relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function fail(message) {
  failures.push(message);
}

function expect(condition, message) {
  if (!condition) fail(message);
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${expected}, got ${actual}`);
}

function validSemver(version) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(version || ''));
}

function firstChangelogEntry(changelog) {
  const match = changelog.match(/^##\s+\[([^\]]+)\]\s+[—-]\s+(\d{4}-\d{2}-\d{2})\s*$/m);
  if (!match) return null;
  const start = match.index;
  const rest = changelog.slice(start + match[0].length);
  const next = rest.search(/\n##\s+\[/);
  const body = next === -1 ? rest : rest.slice(0, next);
  return { version: match[1], date: match[2], body };
}

function assertJsonVersion(relativePath, version) {
  const json = readJson(relativePath);
  expectEqual(json.version, version, `${relativePath} version`);
  if (json.packages?.['']) {
    expectEqual(json.packages[''].version, version, `${relativePath} packages[""].version`);
  }
}

function assertNgrokAcquisitionManifest() {
  const manifestPath = rel('vendor', 'ngrok', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    fail(`ngrok acquisition manifest is missing: ${path.relative(root, manifestPath)}`);
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  expectEqual(manifest.schemaVersion, 2, 'ngrok acquisition manifest schemaVersion');
  expectEqual(manifest.delivery, 'verified-first-run-download', 'ngrok acquisition manifest delivery');
  expect(/^\d+\.\d+\.\d+$/.test(String(manifest.version || '')), 'ngrok acquisition manifest version must be exact semver');
  const spec = manifest.platforms?.win32;
  expect(Boolean(spec), 'ngrok acquisition manifest must declare win32');
  if (!spec) return;
  expectEqual(spec.architecture, 'x64', 'ngrok acquisition architecture');
  expect(/^https:\/\/bin\.ngrok\.com\//.test(String(spec.archive?.url || '')), 'ngrok acquisition archive must use the reviewed bin.ngrok.com URL');
  expect(Number.isSafeInteger(Number(spec.archive?.size)) && Number(spec.archive.size) > 0, 'ngrok acquisition archive size must be positive');
  expect(/^[a-f0-9]{64}$/.test(String(spec.archive?.sha256 || '')), 'ngrok acquisition archive SHA-256 must be exact');
  expectEqual(spec.executable?.file, 'ngrok.exe', 'ngrok acquisition executable filename');
  expect(Number.isSafeInteger(Number(spec.executable?.size)) && Number(spec.executable.size) > 0, 'ngrok acquisition executable size must be positive');
  expect(/^[a-f0-9]{64}$/.test(String(spec.executable?.sha256 || '')), 'ngrok acquisition executable SHA-256 must be exact');
  expect(Boolean(String(spec.authenticode?.publisher || '').trim()), 'ngrok acquisition publisher must be declared');
  expect(Boolean(String(spec.authenticode?.issuer || '').trim()), 'ngrok acquisition certificate issuer must be declared');
  expect(!fs.existsSync(rel('vendor', 'ngrok', 'win32', 'ngrok.exe')), 'ngrok executable must not be committed or bundled from vendor/ngrok');
}

const packageJson = readJson('package.json');
const version = packageJson.version;
expect(validSemver(version), `package.json version must be semver-like x.y.z, got ${version}`);

assertJsonVersion('package.json', version);
assertJsonVersion('package-lock.json', version);
assertJsonVersion(path.join('electron', 'package.json'), version);
assertJsonVersion(path.join('electron', 'package-lock.json'), version);
assertNgrokAcquisitionManifest();

const statusHtml = read(path.join('electron', 'renderer', 'status.html'));
expect(statusHtml.includes(`id="appVersion">v${version}</span>`), `electron/renderer/status.html must display v${version}`);

const changelog = read('CHANGELOG.md');
const entry = firstChangelogEntry(changelog);
expect(entry, 'CHANGELOG.md must start with a ## [version] — YYYY-MM-DD entry after the title');
if (entry) {
  expectEqual(entry.version, version, 'top CHANGELOG.md entry version');
  expect(/^\d{4}-\d{2}-\d{2}$/.test(entry.date), 'top CHANGELOG.md entry date must be YYYY-MM-DD');
  expect(/###\s+/.test(entry.body), 'top CHANGELOG.md entry must include a section heading');
  expect(/^-\s+\*\*/m.test(entry.body), 'top CHANGELOG.md entry must include detailed bold bullet entries');
  expect(new RegExp(String.raw`Bump .*${version.replaceAll('.', ESCAPED_DOT)}\.`, 'i').test(entry.body), `top CHANGELOG.md entry must include a bump line for ${version}`);
  expect(!/\b(TODO|TBD|WIP|placeholder|fill this in|summarize the user-visible change|list validation coverage)\b/i.test(entry.body), 'top CHANGELOG.md entry must not contain placeholder release-note text');
}

const versionModulePath = rel('src', 'version.js');
if (fs.existsSync(versionModulePath)) {
  const { getVersion } = await import(pathToFileURL(versionModulePath).href);
  expectEqual(getVersion(), version, 'src/version.js getVersion()');
}

const releaseManifestPath = rel('release-manifest.json');
if (!fs.existsSync(releaseManifestPath)) {
  fail('release-manifest.json is missing');
} else {
  const releaseManifest = readJson('release-manifest.json');
  expectEqual(releaseManifest.applicationVersion, version, 'release-manifest.json applicationVersion');
  expectEqual(releaseManifest.protocolVersion, '2026-07-28', 'release-manifest.json protocolVersion');
  expect(Number.isInteger(releaseManifest.toolCount) && releaseManifest.toolCount > 0, 'release-manifest.json toolCount must be a positive integer');
  expect(/^[A-Za-z0-9_-]{24}$/.test(String(releaseManifest.manifestHash || '')), 'release-manifest.json manifestHash must be a 24-character base64url digest');

  const runtimeMetadataPath = rel('src', 'runtimeCompatibility.js');
  if (fs.existsSync(runtimeMetadataPath)) {
    const { runtimeMetadata } = await import(`${pathToFileURL(runtimeMetadataPath).href}?releaseCheck=${Date.now()}`);
    const runtime = runtimeMetadata();
    for (const field of ['applicationVersion', 'protocolVersion', 'toolSurfaceVersion', 'toolCount', 'manifestHash', 'schemaVersion']) {
      expectEqual(releaseManifest[field], runtime[field], `release-manifest.json ${field}`);
    }
  }
}

if (failures.length) {
  console.error('Release consistency check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Release consistency check passed for ${version}.`);
