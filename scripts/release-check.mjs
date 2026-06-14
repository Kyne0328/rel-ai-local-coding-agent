import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.REL_AI_RELEASE_ROOT || path.join(__dirname, '..'));
const failures = [];

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
  if (json.packages && json.packages['']) {
    expectEqual(json.packages[''].version, version, `${relativePath} packages[""].version`);
  }
}

const packageJson = readJson('package.json');
const version = packageJson.version;
expect(validSemver(version), `package.json version must be semver-like x.y.z, got ${version}`);

assertJsonVersion('package.json', version);
assertJsonVersion('package-lock.json', version);
assertJsonVersion(path.join('electron', 'package.json'), version);
assertJsonVersion(path.join('electron', 'package-lock.json'), version);

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
  expect(new RegExp(`Bump .*${version.replace(/\./g, '\\.')}\\.`, 'i').test(entry.body), `top CHANGELOG.md entry must include a bump line for ${version}`);
  expect(!/\b(TODO|TBD|WIP|placeholder|fill this in|summarize the user-visible change|list validation coverage)\b/i.test(entry.body), 'top CHANGELOG.md entry must not contain placeholder release-note text');
}

const versionModulePath = rel('src', 'version.js');
if (fs.existsSync(versionModulePath)) {
  const rootRequire = createRequire(rel('package.json'));
  const { getVersion } = rootRequire(versionModulePath);
  expectEqual(getVersion(), version, 'src/version.js getVersion()');
}

if (failures.length) {
  console.error('Release consistency check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Release consistency check passed for ${version}.`);
