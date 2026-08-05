import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { electronPlatformSpec, normalizeElectronPlatform } from './electron-platform.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveCurrentUnpacked(root = defaultRoot, options = {}) {
  return resolveCurrentUnpackedFromDist(path.join(path.resolve(root), 'dist'), options);
}

function resolveCurrentUnpackedFromDist(distRoot, options = {}) {
  const resolvedDist = path.resolve(distRoot);
  const platform = normalizeElectronPlatform(options.platform || process.platform);
  const spec = electronPlatformSpec(platform);
  const markerPath = path.join(resolvedDist, spec.markerName);
  let markedCandidate = null;

  if (fs.existsSync(markerPath)) {
    let marker;
    try {
      marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    } catch (error) {
      throw new Error(`Current unpacked marker is invalid: ${markerPath}.`, { cause: error });
    }
    if (marker.platform && normalizeElectronPlatform(marker.platform) !== platform) {
      throw new Error(`Current unpacked marker targets ${marker.platform}, not ${platform}: ${markerPath}.`);
    }
    const relativePath = String(marker.relativePath || '').trim();
    if (!relativePath) throw new Error(`Current unpacked marker does not contain relativePath: ${markerPath}.`);
    markedCandidate = path.resolve(resolvedDist, relativePath);
    assertContained(resolvedDist, markedCandidate, markerPath);
    assertPackageDirectory(markedCandidate, markerPath, spec);
    if (options.allowBuildCheck !== true) return markedCandidate;
  }

  const candidates = [
    ...(markedCandidate ? [markedCandidate] : []),
    path.join(resolvedDist, spec.unpackedDirectory),
    ...(options.allowBuildCheck === true ? [path.join(resolvedDist, 'build-check', spec.unpackedDirectory)] : [])
  ]
    .filter((directory, index, values) => values.indexOf(directory) === index)
    .filter(directory => fs.existsSync(directory) && fs.statSync(directory).isDirectory())
    .filter(directory => hasExecutable(directory, spec));

  const candidate = options.allowBuildCheck === true
    ? candidates.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0]
    : candidates[0];
  if (candidate) return candidate;
  throw new Error(`No current ${platform} unpacked application was found. Run npm run electron:dist${platform === 'linux' ? ':linux' : ''}${options.allowBuildCheck ? ` or npm run electron:build${platform === 'linux' ? ':linux' : ''}` : ''}.`);
}

function assertContained(parent, candidate, markerPath) {
  const relative = path.relative(parent, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`Current unpacked marker escapes dist: ${markerPath}.`);
  }
}

function assertPackageDirectory(directory, markerPath, spec) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`Current unpacked marker points to a missing directory: ${directory} (${markerPath}).`);
  }
  if (!hasExecutable(directory, spec)) {
    throw new Error(`Current unpacked directory does not contain ${spec.executableName}: ${directory}.`);
  }
}

function hasExecutable(directory, spec) {
  const executable = path.join(directory, spec.executableName);
  return fs.existsSync(executable) && fs.statSync(executable).isFile();
}

function platformArgument(argv) {
  const index = argv.indexOf('--platform');
  if (index < 0) return process.platform;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error('--platform requires win32 or linux.');
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(resolveCurrentUnpacked(defaultRoot, {
    platform: platformArgument(process.argv.slice(2)),
    allowBuildCheck: process.argv.includes('--allow-build-check')
  }));
}

export { resolveCurrentUnpacked, resolveCurrentUnpackedFromDist };
