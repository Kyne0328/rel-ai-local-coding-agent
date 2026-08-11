import fs from 'node:fs';
import path from 'node:path';

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const ECOSYSTEM_LANGUAGES = new Set(['python','java','kotlin','csharp','go','rust','c','cpp','php','ruby']);

function supportsEcosystemResolution(language) { return ECOSYSTEM_LANGUAGES.has(String(language || '').toLowerCase()); }

function createEcosystemResolver(workspaceRoot, indexedPaths = []) {
  const root = path.resolve(String(workspaceRoot || '.'));
  const paths = new Set([...indexedPaths].map(normalize));
  const roots = inferSourceRoots(paths);
  const goModules = new Map();
  const composer = [];
  const cargo = new Map();
  const projects = new Map();
  const includeRoots = new Set();

  for (const relativePath of paths) {
    const lower = relativePath.toLowerCase();
    if (lower.endsWith('/go.mod') || lower === 'go.mod') readGoModule(relativePath, goModules);
    if (lower.endsWith('/composer.json') || lower === 'composer.json') readComposer(relativePath, composer);
    if (lower.endsWith('/cargo.toml') || lower === 'cargo.toml') readCargo(relativePath, cargo);
    if (lower.endsWith('.csproj')) projects.set(path.posix.basename(relativePath, '.csproj').toLowerCase(), path.posix.dirname(relativePath));
    if (lower.endsWith('/compile_commands.json') || lower === 'compile_commands.json') readCompileCommands(relativePath, includeRoots);
    if (lower.endsWith('/pyproject.toml') || lower === 'pyproject.toml') readPythonRoots(relativePath, roots.python);
  }

  function readBounded(relativePath) {
    try {
      const absolute = path.resolve(root, ...normalize(relativePath).split('/'));
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) return '';
      return fs.readFileSync(absolute, 'utf8');
    } catch { return ''; }
  }

  function readGoModule(relativePath, target) {
    const text = readBounded(relativePath);
    const moduleName = text.match(/^\s*module\s+([^\s]+)\s*$/m)?.[1];
    if (moduleName) target.set(moduleName, path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath));
  }

  function readComposer(relativePath, target) {
    const text = readBounded(relativePath);
    if (!text) return;
    try {
      const parsed = JSON.parse(text);
      for (const section of [parsed?.autoload?.['psr-4'], parsed?.['autoload-dev']?.['psr-4']]) {
        if (!section || typeof section !== 'object') continue;
        for (const [prefix, rawDirs] of Object.entries(section)) {
          for (const rawDir of Array.isArray(rawDirs) ? rawDirs : [rawDirs]) {
            const dir = normalize(path.posix.join(path.posix.dirname(relativePath), String(rawDir || '')));
            target.push({ prefix: normalizeNamespace(prefix), dir });
          }
        }
      }
    } catch {}
  }

  function readCargo(relativePath, target) {
    const text = readBounded(relativePath);
    if (!text) return;
    const dir = path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath);
    const packageName = sectionValue(text, 'package', 'name');
    if (packageName) target.set(packageName.replaceAll('-', '_'), dir);
    for (const match of text.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*\{[^\n}]*\bpath\s*=\s*['"]([^'"]+)['"][^}]*\}/gm)) {
      const dependencyDir = normalize(path.posix.join(dir, match[2]));
      if (dependencyDir && !dependencyDir.startsWith('..')) target.set(match[1].replaceAll('-', '_'), dependencyDir);
    }
  }

  function readCompileCommands(relativePath, target) {
    const text = readBounded(relativePath);
    if (!text) return;
    try {
      const entries = JSON.parse(text);
      for (const entry of Array.isArray(entries) ? entries.slice(0, 2000) : []) {
        const directory = String(entry.directory || '');
        const args = Array.isArray(entry.arguments) ? entry.arguments : splitCommand(String(entry.command || ''));
        for (let index = 0; index < args.length; index += 1) {
          let value = '';
          if (args[index] === '-I' || args[index] === '/I') value = args[index + 1] || '';
          else if (/^-I.+/.test(args[index])) value = args[index].slice(2);
          else if (/^\/I.+/i.test(args[index])) value = args[index].slice(2);
          if (!value) continue;
          const absolute = path.resolve(directory || root, value);
          const rel = normalize(path.relative(root, absolute));
          if (rel && !rel.startsWith('..')) target.add(rel);
        }
      }
    } catch {}
  }

  function readPythonRoots(relativePath, target) {
    const text = readBounded(relativePath);
    const dir = path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath);
    for (const match of text.matchAll(/(?:package-dir|package_dir)[^\n]*["']{0,2}\s*=\s*["']([^"']+)["']/gi)) {
      target.add(normalize(path.posix.join(dir, match[1])));
    }
  }

  function candidates(language, sourcePath, specifier) {
    const clean = normalizeSpecifier(specifier);
    if (!clean) return [];
    const values = new Set();
    const add = value => { const normalized = normalize(value).replace(/^\/+/, ''); if (normalized && !normalized.startsWith('..')) values.add(normalized); };
    const sourceDir = path.posix.dirname(normalize(sourcePath));
    if (clean.startsWith('.')) add(path.posix.join(sourceDir, clean));

    if (language === 'go') {
      for (const [moduleName, moduleDir] of goModules) if (clean === moduleName || clean.startsWith(`${moduleName}/`)) add(path.posix.join(moduleDir, clean.slice(moduleName.length)));
    } else if (language === 'php') {
      for (const item of composer) if (clean === item.prefix || clean.startsWith(`${item.prefix}/`)) add(path.posix.join(item.dir, clean.slice(item.prefix.length)));
    } else if (language === 'rust') {
      const [crate, ...rest] = clean.replace(/^crate\//, '').replace(/^self\//, '').split('/');
      if (cargo.has(crate)) add(path.posix.join(cargo.get(crate), 'src', ...rest));
      const localCargo = nearestManifestDir(sourcePath, [...cargo.values()]);
      if (/^(?:crate|self)\//.test(String(specifier || '')) && localCargo != null) add(path.posix.join(localCargo, 'src', crate, ...rest));
    } else if (language === 'python') {
      for (const sourceRoot of roots.python) add(path.posix.join(sourceRoot, clean));
    } else if (language === 'java') {
      for (const sourceRoot of roots.java) add(path.posix.join(sourceRoot, clean));
    } else if (language === 'kotlin') {
      for (const sourceRoot of roots.kotlin) add(path.posix.join(sourceRoot, clean));
    } else if (language === 'c' || language === 'cpp') {
      for (const includeRoot of includeRoots) add(path.posix.join(includeRoot, clean));
      for (const sourceRoot of roots.cFamily) add(path.posix.join(sourceRoot, clean));
    } else if (language === 'csharp') {
      const first = clean.split('/')[0]?.toLowerCase();
      if (projects.has(first)) add(path.posix.join(projects.get(first), clean.split('/').slice(1).join('/')));
    } else if (language === 'ruby') {
      for (const sourceRoot of roots.ruby) add(path.posix.join(sourceRoot, clean));
    }
    return [...values];
  }

  return { candidates };
}

function inferSourceRoots(paths) {
  const roots = { python: new Set(['', 'src']), java: new Set(), kotlin: new Set(), cFamily: new Set(['', 'include', 'src']), ruby: new Set(['', 'lib']) };
  for (const filePath of paths) {
    const normalized = normalize(filePath);
    const java = normalized.match(/^(.*?src\/(?:main|test)\/java)\//);
    if (java) roots.java.add(java[1]);
    const kotlin = normalized.match(/^(.*?src\/(?:main|test)\/kotlin)\//);
    if (kotlin) roots.kotlin.add(kotlin[1]);
    if (/^src\/.*\.py$/i.test(normalized)) roots.python.add('src');
    if (/^lib\/.*\.rb$/i.test(normalized)) roots.ruby.add('lib');
  }
  if (!roots.java.size) roots.java.add('');
  if (!roots.kotlin.size) roots.kotlin.add('');
  return roots;
}

function sectionValue(text, section, key) {
  const block = String(text || '').match(new RegExp(`\\[${escapeRegex(section)}\\]([\\s\\S]*?)(?=\\n\\[|$)`, 'i'))?.[1] || '';
  return block.match(new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*['"]([^'"]+)['"]`, 'mi'))?.[1] || '';
}
function nearestManifestDir(sourcePath, dirs) {
  const source = normalize(sourcePath);
  return dirs.filter(dir => !dir || source === dir || source.startsWith(`${dir}/`)).sort((a, b) => b.length - a.length)[0] ?? null;
}
function normalizeNamespace(value) { return normalize(String(value || '').replaceAll('\\', '/')).replace(/\/$/, ''); }
function normalizeSpecifier(value) { return normalize(String(value || '').replace(/[{}*]/g, '').replaceAll('::', '/').replaceAll('\\', '/').trim()).replace(/^\/+/, ''); }
function normalize(value) { return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/').replace(/\/$/, ''); }
function splitCommand(value) { return String(value || '').match(/(?:[^\s"]+|"[^"]*")+/g)?.map(item => item.replace(/^"|"$/g, '')) || []; }
function escapeRegex(value) { return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export { createEcosystemResolver, supportsEcosystemResolution };


