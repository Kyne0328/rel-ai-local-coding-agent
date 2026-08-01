import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveCurrentUnpacked(root = defaultRoot, options = {}) {
  return resolveCurrentUnpackedFromDist(path.join(path.resolve(root), 'dist'), options);
}

function resolveCurrentUnpackedFromDist(distRoot, options = {}) {
  const resolvedDist = path.resolve(distRoot);
  const markerPath = path.join(resolvedDist, 'current-unpacked.json');
  const candidates = [];

  if (fs.existsSync(markerPath)) {
    let marker;
    try {
      marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    } catch (error) {
      throw new Error(`Current unpacked marker is invalid: ${markerPath}.`, { cause: error });
    }
    const relativePath = String(marker.relativePath || '').trim();
    if (!relativePath) throw new Error(`Current unpacked marker does not contain relativePath: ${markerPath}.`);
    const candidate = path.resolve(resolvedDist, relativePath);
    assertContained(resolvedDist, candidate, markerPath);
    assertPackageDirectory(candidate, markerPath);
    candidates.push({ directory: candidate, source: 'release-marker' });
  } else {
    const preferred = path.join(resolvedDist, 'win-unpacked');
    if (isPackageDirectory(preferred)) candidates.push({ directory: preferred, source: 'preferred-release' });
  }

  if (options.allowBuildCheck === true) {
    const buildCheck = path.join(resolvedDist, 'build-check', 'win-unpacked');
    if (isPackageDirectory(buildCheck)) candidates.push({ directory: buildCheck, source: 'build-check' });
  }

  if (candidates.length === 0) {
    throw new Error(`No current unpacked application was found. Run npm run electron:dist${options.allowBuildCheck ? ' or npm run electron:build' : ''}.`);
  }
  if (candidates.length === 1) return candidates[0].directory;

  candidates.sort((left, right) => packageTimestamp(right.directory) - packageTimestamp(left.directory));
  return candidates[0].directory;
}

function packageTimestamp(directory) {
  return fs.statSync(path.join(directory, 'Rel.AI MCP.exe')).mtimeMs;
}

function isPackageDirectory(directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return false;
  const executable = path.join(directory, 'Rel.AI MCP.exe');
  return fs.existsSync(executable) && fs.statSync(executable).isFile();
}

function assertContained(parent, candidate, markerPath) {
  const relative = path.relative(parent, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`Current unpacked marker escapes dist: ${markerPath}.`);
  }
}

function assertPackageDirectory(directory, markerPath) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`Current unpacked marker points to a missing directory: ${directory} (${markerPath}).`);
  }
  const executable = path.join(directory, 'Rel.AI MCP.exe');
  if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) {
    throw new Error(`Current unpacked directory does not contain Rel.AI MCP.exe: ${directory}.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(resolveCurrentUnpacked());
}

export { resolveCurrentUnpacked, resolveCurrentUnpackedFromDist };
