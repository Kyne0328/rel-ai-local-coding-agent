import { classifyCheckKind } from './checkCatalog.js';

const PARALLEL_SAFE_KINDS = new Set(['lint', 'typecheck', 'security', 'dead_code']);
const MUTATION_HINT = /(?:--fix\b|--write\b|--cache\b|--incremental\b|--build\b|(?:^|\s)-u(?:\s|$)|update.?snapshot|--update\b|\bcoverage\b|\bnyc\b|\bc8\b|\bcodegen\b|\bgenerate\b|\bmigrat(?:e|ion)\b|\bdeploy\b|\bpublish\b|\bwriteFile(?:Sync)?\b|\bappendFile(?:Sync)?\b|\brm(?:Sync)?\b|\brename(?:Sync)?\b|\bcopyFile(?:Sync)?\b|\bmkdir(?:Sync)?\b|(?:^|\s)(?:rm|mv|cp|touch|mkdir|tee)(?:\s|$)|(?:^|\s)>{1,2}(?=\s|[A-Za-z0-9_./'"]))/i;
const MUTATING_SCRIPT_NAME = /(?:^|:)(?:fix|write|update|generate|codegen|build|bundle|compile|prepare|clean|migrate|deploy|publish|release|add|remove|install|format)(?::|$)/i;
const SHELL_CHAIN = /&&|\|\||[;|]/;
const NPM_WRAPPER = /^npm(?:\.cmd)?\s+(?:test|run(?:-script)?\s+[A-Za-z0-9:_-]+)\b/i;

function checkExecutionPolicy(unit = {}) {
  const command = String(unit.command || '').trim();
  const kind = String(unit.kind || '').trim() || classifyCheckKind('', command);
  const scope = String(unit.scopeKey || unit.packageId || unit.cwd || 'repository');
  if (!PARALLEL_SAFE_KINDS.has(kind)) {
    return unsafe(kind, `check kind '${kind || 'other'}' is not explicitly parallel-safe`);
  }

  const chain = Array.isArray(unit.scriptChain) ? unit.scriptChain.filter(Boolean) : [];
  if (NPM_WRAPPER.test(command) && !chain.length) {
    return unsafe(kind, 'npm wrapper command has no resolved manifest script metadata');
  }
  if (MUTATION_HINT.test(command) || MUTATING_SCRIPT_NAME.test(command)) {
    return unsafe(kind, 'command contains a mutation or shared-output hint');
  }

  for (const script of chain) {
    const name = String(script?.name || '');
    const body = String(script?.body || '');
    const scriptKind = String(script?.kind || '') || classifyCheckKind(name, body);
    if (!PARALLEL_SAFE_KINDS.has(scriptKind)) {
      return unsafe(kind, `script '${name || '(unnamed)'}' resolves to non-parallel-safe kind '${scriptKind || 'other'}'`);
    }
    if (MUTATING_SCRIPT_NAME.test(name) || MUTATION_HINT.test(body)) {
      return unsafe(kind, `script '${name || '(unnamed)'}' contains a mutation or shared-output hint`);
    }
    if (SHELL_CHAIN.test(body)) {
      return unsafe(kind, `script '${name || '(unnamed)'}' chains shell operations that cannot be proven side-effect-free`);
    }
  }

  if (!chain.length && SHELL_CHAIN.test(command)) {
    return unsafe(kind, 'command chains shell operations that cannot be proven side-effect-free');
  }

  return {
    parallelSafe: true,
    kind,
    resourceKey: `${kind}:${scope}`,
    reason: chain.length ? 'resolved manifest script is side-effect-free by policy' : 'direct command is side-effect-free by policy'
  };
}

function unsafe(kind, reason) {
  return { parallelSafe: false, kind, resourceKey: '', reason };
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
