import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.REL_AI_RELEASE_ROOT || path.join(__dirname, '..'));
const args = process.argv.slice(2);
const version = args.find((arg) => !arg.startsWith('--')) || '';
const dryRun = args.includes('--dry-run');
const noChangelog = args.includes('--no-changelog');
const allowSame = args.includes('--allow-same');
const dateArg = valueAfter('--date');
const headline = valueAfter('--headline') || 'Release notes';
const notes = valuesFor('--note');
const date = dateArg || new Date().toISOString().slice(0, 10);
const ESCAPED_DOT = String.raw`\.`;

function valueAfter(flag) {
  const index = args.indexOf(flag);
  if (index !== -1) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : '';
}

function valuesFor(flag) {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag && args[i + 1]) values.push(args[i + 1]);
    else if (arg.startsWith(`${flag}=`)) values.push(arg.slice(flag.length + 1));
  }
  return values;
}

function rel(...parts) {
  return path.join(root, ...parts);
}

function read(relativePath) {
  return fs.readFileSync(rel(relativePath), 'utf8');
}

function write(relativePath, content) {
  if (dryRun) return;
  fs.writeFileSync(rel(relativePath), content, 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function writeJson(relativePath, data) {
  write(relativePath, `${JSON.stringify(data, null, 2)}\n`);
}

function die(message) {
  console.error(`release:bump: ${message}`);
  process.exit(1);
}

function validSemver(input) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(input || ''));
}

function compareVersions(a, b) {
  const parse = (v) => String(v).split('-')[0].split('.').map(Number);
  const aa = parse(a);
  const bb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (aa[i] > bb[i]) return 1;
    if (aa[i] < bb[i]) return -1;
  }
  return 0;
}

function updateJsonVersion(relativePath, nextVersion) {
  const json = readJson(relativePath);
  json.version = nextVersion;
  if (json.packages?.['']) json.packages[''].version = nextVersion;
  writeJson(relativePath, json);
}

function replaceExact(relativePath, oldText, newText) {
  const content = read(relativePath);
  if (!content.includes(oldText)) die(`${relativePath} did not contain expected text: ${oldText}`);
  write(relativePath, content.replace(oldText, newText));
}

function changelogHasVersion(content, nextVersion) {
  return new RegExp(String.raw`^## \[${nextVersion.replaceAll('.', ESCAPED_DOT)}\]`, 'm').test(content);
}

function insertChangelog(nextVersion, releaseDate) {
  const changelogPath = 'CHANGELOG.md';
  const content = read(changelogPath);
  if (changelogHasVersion(content, nextVersion)) return;
  const markerMatch = content.match(/^# Changelog(\r?\n)/);
  if (!markerMatch) die('CHANGELOG.md must start with # Changelog');
  const newline = markerMatch[1];
  const marker = `# Changelog${newline}`;
  const bullets = notes.length
    ? notes.map((note) => `- **${note.replace(/\.$/, '')}.**`).join(newline)
    : [
      '- **TODO: summarize the user-visible change.** Replace this placeholder with the complete release note before finalizing the release.',
      '- **TODO: list validation coverage.** Mention the tests or checks that prove the release is safe.'
    ].join(newline);
  const entry = [
    '',
    `## [${nextVersion}] — ${releaseDate}`,
    '',
    `### ${headline}`,
    bullets,
    '',
    `Bump root/electron/status UI/lockfiles to ${nextVersion}.`,
    ''
  ].join(newline);
  write(changelogPath, `${marker}${entry}${content.slice(marker.length)}`);
}

if (!version) die('usage: npm run release:bump -- <version> [--date YYYY-MM-DD] [--dry-run]');
if (!validSemver(version)) die(`version must be semver-like x.y.z, got ${version}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die(`date must be YYYY-MM-DD, got ${date}`);

const packageJson = readJson('package.json');
const current = packageJson.version;
if (!allowSame && compareVersions(version, current) <= 0) {
  die(`new version ${version} must be greater than current ${current}; pass --allow-same to rewrite the same version`);
}

const files = [
  'package.json',
  'package-lock.json',
  path.join('electron', 'package.json'),
  path.join('electron', 'package-lock.json')
];

for (const file of files) updateJsonVersion(file, version);
const releaseManifest = readJson('release-manifest.json');
releaseManifest.applicationVersion = version;
writeJson('release-manifest.json', releaseManifest);
replaceExact(path.join('electron', 'renderer', 'status.html'), `id="appVersion">v${current}</span>`, `id="appVersion">v${version}</span>`);
if (!noChangelog) insertChangelog(version, date);

if (!dryRun && notes.length) {
  const check = spawnSync(process.execPath, [rel('scripts', 'release-check.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, REL_AI_RELEASE_ROOT: root } });
  if (check.status !== 0) process.exit(check.status || 1);
}

console.log(`${dryRun ? 'Would bump' : 'Bumped'} ${current} -> ${version}.`);
