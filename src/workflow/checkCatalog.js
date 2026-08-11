function buildCheckCatalog(topology) {
  const checks = [];
  for (const pkg of topology?.packages || []) {
    if (pkg.ecosystem === 'npm') addNpmChecks(checks, pkg);
    else addDefaultChecks(checks, pkg);
  }
  return checks;
}

function addNpmChecks(target, pkg) {
  for (const scriptName of Object.keys(pkg.scripts || {}).sort()) {
    const kind = classifyCheckKind(scriptName, pkg.scripts[scriptName]);
    const command = scriptName === 'test' ? 'npm test' : `npm run ${scriptName}`;
    target.push(unit(pkg, `${pkg.id}:${scriptName}`, command, kind, 'manifest'));
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

function unit(pkg, id, command, kind, source) {
  return {
    id, packageId: pkg.id, cwd: pkg.path === '.' ? '.' : pkg.path, command, kind,
    level: ['build', 'security', 'dead_code'].includes(kind) ? 'standard' : 'focused',
    estimatedCost: ['build', 'security', 'dead_code'].includes(kind) ? 'large' : kind === 'test' ? 'medium' : 'small',
    source, scopeKey: `package:${pkg.id}`
  };
}

function classifyCheckKind(name, command = '') {
  const token = `${name} ${command}`.toLowerCase();
  if (/migrat|prisma\s+(?:migrate|db push)|sequelize.*db:migrate/.test(token)) return 'migration';
  if (/dead.?code|\bknip\b|unused/.test(token)) return 'dead_code';
  if (/security|audit|snyk|semgrep/.test(token)) return 'security';
  if (/type.?check|tsc(?:\s|$)/.test(token)) return 'typecheck';
  if (/lint/.test(token)) return 'lint';
  if (/format|prettier/.test(token)) return 'format';
  if (/build|compile|bundle/.test(token)) return 'build';
  if (/test|spec/.test(token)) return 'test';
  return 'other';
}

function selectChecksForPackages(catalog, packageIds, options = {}) {
  const ids = new Set(packageIds || []);
  const allowedKinds = options.kinds ? new Set(options.kinds) : null;
  return (catalog || []).filter(item => ids.has(item.packageId))
    .filter(item => item.kind !== 'migration')
    .filter(item => !allowedKinds || allowedKinds.has(item.kind));
}

export { buildCheckCatalog, selectChecksForPackages };