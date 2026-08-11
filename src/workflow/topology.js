import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MAX_DEPTH = 6;
const MAX_MANIFESTS = 200;
const CACHE_RECHECK_MS = 2_000;
const MANIFEST_NAMES = new Set(['package.json', 'pubspec.yaml', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'requirements.txt', 'Makefile']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', '.turbo', '.cache', '.relai', '.rel-ai', 'state']);
const cache = new Map();

function discoverRepositoryTopology(rootPath) {
  const root = path.resolve(String(rootPath || '.'));
  const cached = cache.get(root);
  if (cached && Date.now() - cached.checkedAt < CACHE_RECHECK_MS) return structuredClone(cached.value);
  const manifests = collectManifests(root);
  const signature = manifests.map(item => `${item.relative}:${item.size}:${item.mtimeMs}`).join('|');
  if (cached?.signature === signature) {
    cached.checkedAt = Date.now();
    return structuredClone(cached.value);
  }
  const packages = manifests.map(item => packageFromManifest(root, item)).filter(Boolean);
  const value = {
    version: 1,
    root,
    manifests: manifests.map(item => item.relative),
    packages,
    fingerprint: crypto.createHash('sha256').update(signature).digest('hex')
  };
  cache.set(root, { signature, value, checkedAt: Date.now() });
  if (cache.size > 32) cache.delete(cache.keys().next().value);
  return structuredClone(value);
}

function collectManifests(root) {
  const found = [];
  const queue = [{ absolute: root, depth: 0 }];
  while (queue.length && found.length < MAX_MANIFESTS) {
    const current = queue.shift();
    let entries;
    try { entries = fs.readdirSync(current.absolute, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (found.length >= MAX_MANIFESTS) break;
      if (entry.isDirectory()) {
        if (current.depth >= MAX_DEPTH || SKIP_DIRS.has(entry.name) || looksSensitive(entry.name)) continue;
        queue.push({ absolute: path.join(current.absolute, entry.name), depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile() || !MANIFEST_NAMES.has(entry.name)) continue;
      const absolute = path.join(current.absolute, entry.name);
      let stat;
      try { stat = fs.statSync(absolute); } catch { continue; }
      found.push({ absolute, relative: normalize(path.relative(root, absolute)), size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) });
    }
  }
  return found.sort((a, b) => a.relative.localeCompare(b.relative));
}

function packageFromManifest(root, manifest) {
  const packagePath = normalize(path.dirname(manifest.relative)) || '.';
  const name = path.basename(manifest.relative);
  if (name === 'package.json') return npmPackage(root, manifest, packagePath);
  const ecosystem = name === 'pubspec.yaml' ? 'flutter'
    : name === 'go.mod' ? 'go'
      : name === 'Cargo.toml' ? 'cargo'
        : ['pyproject.toml', 'requirements.txt'].includes(name) ? 'python'
          : name === 'Makefile' ? 'make' : '';
  if (!ecosystem) return null;
  return {
    id: packageId(ecosystem, packagePath), path: packagePath, ecosystem, manifest: manifest.relative,
    name: packagePath === '.' ? path.basename(root) : path.basename(packagePath), scripts: {},
    sourceRoots: existingRoots(root, packagePath, ['src', 'lib', 'app']),
    testRoots: existingRoots(root, packagePath, ['test', 'tests', '__tests__']), dependencies: [], workspaceDependencies: []
  };
}

function npmPackage(root, manifest, packagePath) {
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(manifest.absolute, 'utf8')); } catch {}
  const dependencies = Object.keys({ ...(object(pkg.dependencies)), ...(object(pkg.devDependencies)) }).sort();
  return {
    id: packageId('npm', packagePath), path: packagePath, ecosystem: 'npm', manifest: manifest.relative,
    name: String(pkg.name || (packagePath === '.' ? path.basename(root) : path.basename(packagePath))),
    scripts: object(pkg.scripts),
    sourceRoots: existingRoots(root, packagePath, ['src', 'lib', 'app']),
    testRoots: existingRoots(root, packagePath, ['test', 'tests', '__tests__']), dependencies, workspaceDependencies: []
  };
}

function packageForPath(topology, filePath) {
  const target = normalize(filePath);
  return [...(topology?.packages || [])]
    .filter(item => item.path === '.' || target === item.path || target.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0] || null;
}

function packageId(ecosystem, packagePath) { return packagePath === '.' ? `${ecosystem}:root` : `${ecosystem}:${packagePath}`; }
function existingRoots(root, packagePath, names) {
  return names.map(name => normalize(packagePath === '.' ? name : `${packagePath}/${name}`))
    .filter(relative => { try { return fs.statSync(path.join(root, relative)).isDirectory(); } catch { return false; } });
}
function looksSensitive(name) { return /secret|credential|token|private|keychain/i.test(name); }
function normalize(value) { return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, ''); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clearTopologyCache() { cache.clear(); }

export { clearTopologyCache, discoverRepositoryTopology, packageForPath };