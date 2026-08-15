function buildCheckCatalog(topology) {
  const checks = [];
  for (const pkg of topology?.packages || []) {
    if (pkg.ecosystem === 'npm') addNpmChecks(checks, pkg);
    else addDefaultChecks(checks, pkg);
  }
  return checks;
}

function addNpmChecks(target, pkg) {
  const scripts = pkg.scripts || {};
  for (const scriptName of Object.keys(scripts).sort()) {
    const scriptBody = String(scripts[scriptName] || '');
    const kind = classifyCheckKind(scriptName, scriptBody);
    const command = scriptName === 'test' ? 'npm test' : `npm run ${scriptName}`;
    const scriptChain = npmScriptChain(scripts, scriptName).map(item => ({
      ...item,
      kind: classifyCheckKind(item.name, item.body)
    }));
    target.push(unit(pkg, `${pkg.id}:${scriptName}`, command, kind, 'manifest', {
      ecosystem: 'npm',
      scriptName,
      scriptBody,
      scriptChain
    }));
  }
}

function addDefaultChecks(target, pkg) {
  const commands = pkg.ecosystem === 'flutter' ? [['analyze', 'flutter analyze', 'typecheck'], ['test', 'flutter test', 'test']]
    : pkg.ecosystem === 'go' ? [['test', 'go test ./...', 'test'], ['build', 'go build ./...', 'build']]
      : pkg.ecosystem === 'cargo' ? [['test', 'cargo test', 'test'], ['build', 'cargo build', 'build'], ['clippy', 'cargo clippy', 'lint']]
        : pkg.ecosystem === 'python' ? [['test', 'python -m pytest', 'test']]
          : [];
  for (const [name, command, kind] of commands) target.push(unit(pkg, `${pkg.id}:${name}`, command, kind, 'manifest'));
}

function unit(pkg, id, command, kind, source, metadata = {}) {
  return {
    id, packageId: pkg.id, cwd: pkg.path === '.' ? '.' : pkg.path, command, kind,
    level: ['build', 'security', 'dead_code'].includes(kind) ? 'standard' : 'focused',
    estimatedCost: ['build', 'security', 'dead_code'].includes(kind) ? 'large' : kind === 'test' ? 'medium' : 'small',
    source, scopeKey: `package:${pkg.id}`,
    ...metadata
  };
}

function npmScriptChain(scripts, rootName) {
  const output = [];
  const visited = new Set();
  const visit = (name) => {
    if (!name || visited.has(name) || !Object.hasOwn(scripts, name)) return;
    visited.add(name);
    const body = String(scripts[name] || '');
    output.push({ name, body });
    for (const reference of npmScriptReferences(body)) visit(reference);
  };
  visit(rootName);
  return output;
}

function npmScriptReferences(script) {
  const references = [];
  const expression = /\bnpm(?:\.cmd)?\s+(?:(?:run|run-script)\s+)?([A-Za-z0-9:_-]+)/g;
  for (const match of String(script || '').matchAll(expression)) {
    const name = String(match[1] || '');
    if (name && name !== 'run' && name !== 'run-script') references.push(name);
  }
  return [...new Set(references)];
}

const NON_VALIDATION_KINDS = new Set([
  'migration', 'benchmark', 'service', 'release', 'setup', 'cleanup', 'generator', 'package'
]);

function classifyCheckKind(name, command = '') {
  const scriptName = String(name || '').toLowerCase();
  const token = `${scriptName} ${command}`.toLowerCase();
  // Operational and mutating npm scripts are never automatic validation.
  // A test named test:release is still a test because exclusions key off the prefix.
  if (/^benchmark(?::|$)/.test(scriptName)) return 'benchmark';
  if (/^(?:watch|dev|start|serve)(?::|$)/.test(scriptName)) return 'service';
  if (/^(?:release|publish|deploy)(?::|$)/.test(scriptName)) return 'release';
  if (/^(?:fetch|install|postinstall|setup|init)(?::|$)/.test(scriptName)) return 'setup';
  if (/^clean(?::|$)/.test(scriptName)) return 'cleanup';
  if (/^(?:generate|prepare)(?::|$)/.test(scriptName)) return 'generator';
  if (/^(?:dist|package|electron:dist)(?::|$)/.test(scriptName)) return 'package';
  if (/migrat|prisma\s+(?:migrate|db push)|sequelize.*db:migrate/.test(token)) return 'migration';
  if (/^test(?::|$)|^(?:spec|smoke|acceptance)(?::|$)/.test(scriptName)) return 'test';
  if (/^type.?check(?::|$)/.test(scriptName)) return 'typecheck';
  if (/^lint(?::|$)/.test(scriptName)) return 'lint';
  if (/^format(?::|$)/.test(scriptName)) return 'format';
  if (/^check(?::|$)|^verify(?::|$)|^validate(?::|$)/.test(scriptName)) return 'verification';
  if (/dead.?code|\bknip\b|unused/.test(token)) return 'dead_code';
  if (/security|audit|snyk|semgrep/.test(token)) return 'security';
  if (/type.?check|\btsc(?:\s|$)/.test(token)) return 'typecheck';
  if (/\blint\b|\beslint\b|\bruff\s+check\b/.test(token)) return 'lint';
  if (/format|prettier/.test(token)) return 'format';
  if (/build|compile|bundle/.test(token)) return 'build';
  if (/\b(?:jest|vitest|mocha|pytest)\b|\b(?:cargo|go|flutter)\s+test\b/.test(token)) return 'test';
  return 'other';
}

function selectChecksForPackages(catalog, packageIds, options = {}) {
  const ids = new Set(packageIds || []);
  const allowedKinds = options.kinds ? new Set(options.kinds) : null;
  return (catalog || []).filter(item => ids.has(item.packageId))
    .filter(item => !NON_VALIDATION_KINDS.has(item.kind))
    .filter(item => item.kind !== 'other')
    .filter(item => !allowedKinds || allowedKinds.has(item.kind));
}

export { buildCheckCatalog, classifyCheckKind, selectChecksForPackages };