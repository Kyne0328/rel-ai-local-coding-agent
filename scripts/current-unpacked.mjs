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
  let markedCandidate = null;

  if (fs.existsSync(markerPath)) {
    let marker;
    try {
      marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    } catch (error) {
      throw new Error(`Current unpacked marker is invalid: ${markerPath}.`, { cause: error });
    }
    const relativePath = String(marker.relativePath || '').trim();
    if (!relativePath) throw new Error(`Current unpacked marker does not contain relativePath: ${markerPath}.`);
    markedCandidate = path.resolve(resolvedDist, relativePath);
    assertContained(resolvedDist, markedCandidate, markerPath);
    assertPackageDirectory(markedCandidate, markerPath);
    if (options.allowBuildCheck !== true) return markedCandidate;
  }

  const candidates = [
    ...(markedCandidate ? [markedCandidate] : []),
    path.join(resolvedDist, 'win-unpacked'),
    ...(options.allowBuildCheck === true ? [path.join(resolvedDist, 'build-check', 'win-unpacked')] : [])
  ]
    .filter((directory, index, values) => values.indexOf(directory) === index)
    .filter(directory => fs.existsSync(directory) && fs.statSync(directory).isDirectory());

  const candidate = options.allowBuildCheck === true
    ? candidates.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0]
    : candidates[0];
  if (candidate) return candidate;
  throw new Error(`No current unpacked application was found. Run npm run electron:dist${options.allowBuildCheck ? ' or npm run electron:build' : ''}.`);
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
