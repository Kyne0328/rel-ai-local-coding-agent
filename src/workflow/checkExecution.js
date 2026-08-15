import { classifyCheckKind } from './checkCatalog.js';

const PARALLEL_SAFE_KINDS = new Set(['test', 'lint', 'typecheck', 'security', 'dead_code']);
const MUTATION_HINT = /(?:--fix\b|--write\b|update.?snapshot|\bcoverage\b|\bnyc\b|\bc8\b|\bcodegen\b|\bgenerate\b|\bmigrat(?:e|ion)\b|\bdeploy\b|\bpublish\b)/i;

function checkExecutionPolicy(unit = {}) {
  const command = String(unit.command || '').trim();
  const kind = String(unit.kind || '').trim() || classifyCheckKind('', command);
  const scope = String(unit.scopeKey || unit.packageId || unit.cwd || 'repository');
  if (!PARALLEL_SAFE_KINDS.has(kind)) {
    return { parallelSafe: false, kind, resourceKey: '', reason: `check kind '${kind || 'other'}' is not known read-only` };
  }
  if (MUTATION_HINT.test(command)) {
    return { parallelSafe: false, kind, resourceKey: '', reason: 'command contains a mutation or shared-output hint' };
  }
  return {
    parallelSafe: true,
    kind,
    resourceKey: `${kind}:${scope}`,
    reason: 'known non-mutating validation kind'
  };
}

function buildCheckExecutionStages(units = []) {
  const stages = [];
  let current = [];
  const resourceKeys = new Set();

  function flushParallel() {
    if (!current.length) return;
    stages.push({ parallel: current.length > 1, items: current });
    current = [];
    resourceKeys.clear();
  }

  units.forEach((unit, index) => {
    const policy = checkExecutionPolicy(unit);
    const item = { unit, index, policy };
    if (!policy.parallelSafe) {
      flushParallel();
      stages.push({ parallel: false, items: [item] });
      return;
    }
    if (resourceKeys.has(policy.resourceKey)) flushParallel();
    current.push(item);
    resourceKeys.add(policy.resourceKey);
  });
  flushParallel();
  return stages;
}

export { buildCheckExecutionStages, checkExecutionPolicy };
