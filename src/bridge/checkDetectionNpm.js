import * as fs from 'node:fs';
import * as path from 'node:path';

function detectPackageJsonChecks(root, level, commands) {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const scripts = pkg.scripts || {};
    if (level === 'release' && scripts['test:all']) {
      commands.push('npm run test:all');
      if (scripts['electron:build'] && !npmScriptInvokes(scripts, 'test:all', 'electron:build')) commands.push('npm run electron:build');
      else if (scripts.build && !npmScriptInvokes(scripts, 'test:all', 'build')) commands.push('npm run build');
      return;
    }
    const hasStandardTest = level !== 'quick' && Boolean(scripts.test);
    const testCoversCheck = hasStandardTest && npmScriptInvokes(scripts, 'test', 'check');
    if (scripts.check && !testCoversCheck) commands.push('npm run check');
    else if (level === 'quick' && fs.existsSync(path.join(root, 'src', 'tools.js'))) commands.push('node --check src/tools.js');
    if (hasStandardTest) commands.push(canonicalNpmScriptCommand(scripts, 'test'));
    const testCoversBuild = hasStandardTest && npmScriptInvokes(scripts, 'test', 'build');
    if (scripts.build && !testCoversBuild && shouldRunPackageBuild(root, pkg, scripts, level, commands)) commands.push('npm run build');
  } catch {
    if (level === 'quick' && fs.existsSync(path.join(root, 'src', 'tools.js'))) commands.push('node --check src/tools.js');
  }
}

function npmScriptInvokes(scripts, sourceName, targetName, seen = new Set()) {
  if (!sourceName || seen.has(sourceName)) return false;
  seen.add(sourceName);
  const script = String(scripts?.[sourceName] || '');
  const references = [...script.matchAll(/\bnpm(?:\.cmd)?\s+(?:(?:run|run-script)\s+)?([A-Za-z0-9:_-]+)/g)].map(match => match[1]);
  for (const reference of references) {
    if (reference === targetName) return true;
    if (npmScriptInvokes(scripts, reference, targetName, seen)) return true;
  }
  return false;
}

function canonicalNpmScriptCommand(scripts, scriptName) {
  const script = String(scripts?.[scriptName] || '').trim();
  const alias = /^npm(?:\.cmd)?\s+(?:run|run-script)\s+([A-Za-z0-9:_-]+)$/.exec(script);
  if (alias) return `npm run ${alias[1]}`;
  return scriptName === 'test' ? 'npm test' : `npm run ${scriptName}`;
}

function shouldRunPackageBuild(root, pkg, scripts, level, currentCommands) {
  if (level === 'quick') return false;
  if (level === 'full' || level === 'release') return true;
  if (!currentCommands?.length) return true;
  const allDeps = {
    ...(typeof pkg?.dependencies === 'object' ? pkg.dependencies : {}),
    ...(typeof pkg?.devDependencies === 'object' ? pkg.devDependencies : {})
  };
  const dependencyNames = new Set(Object.keys(allDeps));
  const buildCriticalDeps = ['next', 'vite', 'nuxt', 'astro', '@remix-run/dev', '@sveltejs/kit', 'react-scripts', 'webpack', 'parcel'];
  if (buildCriticalDeps.some(name => dependencyNames.has(name))) return true;
  const build = String(scripts?.build || '');
  if (/\b(next|vite|nuxt|astro|remix|svelte-kit|react-scripts|webpack|parcel)\b/i.test(build)) return true;
  return fs.existsSync(path.join(root, 'next.config.js')) || fs.existsSync(path.join(root, 'next.config.mjs'));
}

export { detectPackageJsonChecks };
