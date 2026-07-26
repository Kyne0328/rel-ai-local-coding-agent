'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { collectTextFiles, collectOptionsFromWorkspace, resolveSafePath, looksBinary } = require('../safety');
const { discoverCommands } = require('../commandDiscovery');
const { detectVerifyChecks } = require('./validation');
const { clampNumber } = require('./limits');

const CACHE = new Map();
const DEFAULT_MAX_RESULTS = 200;
const DEFAULT_MAX_FILES = 5000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_LINE_CHARS = 400;
const EXTENSION_LANGUAGE = new Map([
  ['.js', 'javascript'], ['.jsx', 'javascript'], ['.mjs', 'javascript'], ['.cjs', 'javascript'],
  ['.ts', 'typescript'], ['.tsx', 'typescript'], ['.py', 'python'], ['.go', 'go'], ['.rs', 'rust'],
  ['.dart', 'dart'], ['.java', 'java'], ['.kt', 'kotlin'], ['.swift', 'swift'], ['.cs', 'csharp'],
  ['.c', 'c'], ['.h', 'c'], ['.cpp', 'cpp'], ['.cc', 'cpp'], ['.hpp', 'cpp'], ['.rb', 'ruby'],
  ['.php', 'php'], ['.vue', 'vue'], ['.svelte', 'svelte']
]);
const RESOLVE_EXTENSIONS = [...EXTENSION_LANGUAGE.keys(), '.json'];
const JS_CONTROL_WORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'constructor']);

async function relaiCodeInspect(workspace, _config, args = {}) {
  const action = String(args.action || '').trim().toLowerCase();
  if (!['symbol', 'references', 'related', 'impact', 'diagnostics'].includes(action)) {
    throw new Error('relai_code_inspect action must be one of: symbol, references, related, impact, diagnostics.');
  }
  const maxResults = Math.floor(clampNumber(args.maxResults, 1, 1000, DEFAULT_MAX_RESULTS));
  const loaded = loadIndex(workspace, args);
  const base = {
    ok: true,
    workspace: workspace.alias,
    action,
    index: indexMetadata(loaded, workspace)
  };

  if (action === 'diagnostics') return { ...base, ...diagnosticReadiness(workspace, loaded.index) };
  if (action === 'related') {
    const query = String(args.query || args.symbol || '').trim();
    if (!query) throw new Error('relai_code_inspect related requires query or symbol.');
    return { ...base, query, ...relatedFiles(loaded.index, query, maxResults) };
  }

  const symbol = String(args.symbol || '').trim();
  const requestedPaths = Array.isArray(args.paths) ? args.paths.filter(Boolean) : [];
  const pathOnlyImpact = action === 'impact' && !symbol && requestedPaths.length > 0;
  if (!symbol && !pathOnlyImpact) throw new Error(`relai_code_inspect ${action} requires symbol${action === 'impact' ? ' or paths' : ''}.`);
  if (symbol && !/^[A-Za-z_$][A-Za-z0-9_$.:#-]{0,255}$/.test(symbol)) throw new Error('symbol must be a simple code identifier or qualified identifier.');
  const definitions = symbol ? findDefinitions(loaded.index, symbol, maxResults) : [];
  const references = symbol ? findReferences(loaded.index, symbol, maxResults) : emptyReferences();

  if (action === 'symbol') {
    return {
      ...base,
      symbol,
      definitions,
      definitionCount: countDefinitions(loaded.index, symbol),
      references: references.items.slice(0, Math.min(50, maxResults)),
      referenceCount: references.referenceCount,
      callCount: references.callCount,
      truncated: definitions.length >= maxResults || references.truncated,
      next: definitions.length ? 'Use action references or impact to trace callers, importers, and affected tests.' : 'No definition was recognized. Use related for structural retrieval or relai_search for raw text.'
    };
  }
  if (action === 'references') {
    return { ...base, symbol, definitions, ...references };
  }
  return { ...base, ...(symbol ? { symbol } : {}), ...impactAnalysis(workspace, loaded.index, symbol, definitions, references, args, maxResults) };
}

function emptyReferences() {
  return { items: [], matchCount: 0, referenceCount: 0, callCount: 0, truncated: false };
}

function loadIndex(workspace, args) {
  const maxFiles = Math.floor(clampNumber(args.maxFiles, 1, 20000, DEFAULT_MAX_FILES));
  const tree = collectTextFiles(workspace.path, collectOptionsFromWorkspace(workspace, { maxEntries: maxFiles }));
  const candidates = [];
  let newestMtimeMs = 0;
  for (const relativePath of tree.files) {
    if (!EXTENSION_LANGUAGE.has(path.extname(relativePath).toLowerCase())) continue;
    try {
      const safe = resolveSafePath(workspace.path, relativePath, { operation: 'read' });
      const stat = fs.statSync(safe.absolutePath);
      if (!stat.isFile()) continue;
      newestMtimeMs = Math.max(newestMtimeMs, stat.mtimeMs);
      candidates.push({ path: safe.relativePath.replaceAll('\\', '/'), absolutePath: safe.absolutePath, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch {}
  }
  const fingerprint = crypto.createHash('sha256').update(candidates.map(item => `${item.path}:${item.size}:${item.mtimeMs}`).join('\n')).digest('hex');
  const key = fs.realpathSync(workspace.path);
  const cached = CACHE.get(key);
  if (cached?.fingerprint === fingerprint) {
    return { index: cached.index, fingerprint, cacheHit: true, checkedAt: new Date().toISOString(), treeTruncated: tree.truncated, newestMtimeMs };
  }
  const index = buildIndex(candidates, tree);
  CACHE.set(key, { fingerprint, index });
  return { index, fingerprint, cacheHit: false, checkedAt: new Date().toISOString(), treeTruncated: tree.truncated, newestMtimeMs };
}

function buildIndex(candidates, tree) {
  const files = [];
  const fileByPath = new Map();
  const definitionsByName = new Map();
  const imports = new Map();
  const reverseImports = new Map();
  const languages = {};
  let indexedBytes = 0;
  let skippedLargeFiles = 0;
  let contentTruncated = false;

  for (const candidate of candidates) {
    if (candidate.size > MAX_FILE_BYTES || indexedBytes + candidate.size > MAX_TOTAL_BYTES) {
      skippedLargeFiles += 1;
      contentTruncated = true;
      continue;
    }
    try {
      const data = fs.readFileSync(candidate.absolutePath);
      if (looksBinary(data)) continue;
      const text = data.toString('utf8');
      const language = EXTENSION_LANGUAGE.get(path.extname(candidate.path).toLowerCase()) || 'text';
      const lines = text.split(/\r\n|\n|\r/);
      const definitions = extractDefinitions(lines, language, candidate.path);
      const file = { path: candidate.path, language, test: isTestPath(candidate.path), text, lines, definitions, imports: [] };
      files.push(file);
      fileByPath.set(file.path, file);
      languages[language] = (languages[language] || 0) + 1;
      indexedBytes += data.length;
      for (const definition of definitions) {
        if (!definitionsByName.has(definition.name)) definitionsByName.set(definition.name, []);
        definitionsByName.get(definition.name).push(definition);
      }
    } catch {}
  }

  const knownPaths = new Set(files.map(file => file.path));
  for (const file of files) {
    file.imports = extractImports(file.text).map(specifier => resolveImport(file.path, specifier, knownPaths)).filter(Boolean);
    imports.set(file.path, new Set(file.imports));
    for (const target of file.imports) {
      if (!reverseImports.has(target)) reverseImports.set(target, new Set());
      reverseImports.get(target).add(file.path);
    }
  }

  return {
    files, fileByPath, definitionsByName, imports, reverseImports, languages,
    indexedBytes, skippedLargeFiles, contentTruncated,
    sourceFileCount: files.length,
    discoveredFileCount: tree.files.length,
    collectionSkippedCount: tree.skipped.length,
    builtAt: new Date().toISOString()
  };
}

function extractDefinitions(lines, language, relativePath) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const found = definitionsFromLine(line, language);
    for (const item of found) definitions.push({ ...item, path: relativePath, line: index + 1, language, text: line.trim().slice(0, MAX_LINE_CHARS) });
  }
  return definitions;
}

function definitionsFromLine(line, language) {
  const patterns = [];
  if (['javascript', 'typescript', 'vue', 'svelte'].includes(language)) {
    patterns.push(['function', /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/]);
    patterns.push(['class', /\b(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/]);
    patterns.push(['variable', /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/]);
    const method = /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*\{/i.exec(line);
    if (method && !JS_CONTROL_WORDS.has(method[1])) patterns.push(['method', new RegExp(`^\\s*(?:async\\s+)?(${escapeRegExp(method[1])})\\s*\\(`)]);
  } else if (language === 'python') {
    patterns.push(['function', /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/], ['class', /^\s*class\s+([A-Za-z_]\w*)/]);
  } else if (language === 'go') {
    patterns.push(['function', /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/], ['type', /^\s*type\s+([A-Za-z_]\w*)/]);
  } else if (language === 'rust') {
    patterns.push(['function', /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/], ['type', /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/]);
  } else {
    patterns.push(['type', /\b(?:class|interface|enum|record|struct|trait)\s+([A-Za-z_]\w*)/]);
    patterns.push(['function', /\b(?:fun|func|def|function)\s+([A-Za-z_]\w*)/]);
  }
  const found = [];
  const seen = new Set();
  for (const [kind, regex] of patterns) {
    const match = regex.exec(line);
    if (match?.[1] && !seen.has(match[1])) {
      seen.add(match[1]);
      found.push({ name: match[1], kind });
    }
  }
  return found;
}

function extractImports(text) {
  const specifiers = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const regex of patterns) for (const match of text.matchAll(regex)) if (match[1]) specifiers.push(match[1]);
  return [...new Set(specifiers)];
}

function resolveImport(fromPath, specifier, knownPaths) {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  const candidates = [base, ...RESOLVE_EXTENSIONS.map(ext => base + ext), ...RESOLVE_EXTENSIONS.map(ext => path.posix.join(base, `index${ext}`))];
  return candidates.find(candidate => knownPaths.has(candidate)) || null;
}

function findDefinitions(index, symbol, maxResults) {
  const simple = simpleSymbol(symbol);
  return (index.definitionsByName.get(simple) || []).slice(0, maxResults);
}

function countDefinitions(index, symbol) {
  return (index.definitionsByName.get(simpleSymbol(symbol)) || []).length;
}

function findReferences(index, symbol, maxResults) {
  const simple = simpleSymbol(symbol);
  const matcher = new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(simple)}([^A-Za-z0-9_$]|$)`);
  const definitionKeys = new Set((index.definitionsByName.get(simple) || []).map(item => `${item.path}:${item.line}`));
  const items = [];
  let matchCount = 0;
  let referenceCount = 0;
  let callCount = 0;
  for (const file of index.files) {
    for (let lineIndex = 0; lineIndex < file.lines.length; lineIndex += 1) {
      const line = file.lines[lineIndex];
      if (!matcher.test(line)) continue;
      const lineNumber = lineIndex + 1;
      const definition = definitionKeys.has(`${file.path}:${lineNumber}`);
      const classification = classifyReference(line, simple, definition);
      matchCount += 1;
      if (!definition) referenceCount += 1;
      if (classification === 'call') callCount += 1;
      if (items.length < maxResults) items.push({ path: file.path, line: lineNumber, language: file.language, test: file.test, classification, text: line.trim().slice(0, MAX_LINE_CHARS) });
    }
  }
  return { items, matchCount, referenceCount, callCount, truncated: matchCount > items.length };
}

function classifyReference(line, symbol, definition) {
  if (definition) return 'definition';
  if (/\b(?:import|export|require)\b/.test(line)) return 'import';
  if (new RegExp(`\\b(?:new\\s+)?${escapeRegExp(symbol)}\\s*\\(`).test(line)) return 'call';
  if (new RegExp(`\\.${escapeRegExp(symbol)}\\b`).test(line)) return 'property';
  return 'usage';
}

function relatedFiles(index, query, maxResults) {
  const terms = queryTerms(query);
  const ranked = [];
  for (const file of index.files) {
    let score = 0;
    const reasons = [];
    const pathText = file.path.toLowerCase();
    const snippets = [];
    for (const term of terms) {
      if (pathText.includes(term)) { score += 8; reasons.push(`path:${term}`); }
      const named = file.definitions.filter(item => item.name.toLowerCase().includes(term));
      if (named.length) { score += Math.min(15, named.length * 5); reasons.push(`symbol:${term}`); }
      for (let indexLine = 0; indexLine < file.lines.length && snippets.length < 3; indexLine += 1) {
        if (file.lines[indexLine].toLowerCase().includes(term)) snippets.push({ line: indexLine + 1, text: file.lines[indexLine].trim().slice(0, MAX_LINE_CHARS) });
      }
      if (snippets.some(item => item.text.toLowerCase().includes(term))) score += 2;
    }
    if (score > 0) ranked.push({ path: file.path, language: file.language, test: file.test, score, reasons: [...new Set(reasons)], snippets });
  }
  ranked.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  return {
    strategy: 'lexical-structural',
    semanticEmbeddings: false,
    files: ranked.slice(0, maxResults),
    matchCount: ranked.length,
    truncated: ranked.length > maxResults,
    next: 'Results are ranked by paths, recognized symbols, and matching source lines. Use symbol or impact for relationship tracing.'
  };
}

function impactAnalysis(workspace, index, symbol, definitions, references, args, maxResults) {
  const maxDepth = Math.floor(clampNumber(args.maxDepth, 1, 8, 3));
  const seeds = new Set(definitions.map(item => item.path));
  for (const requested of Array.isArray(args.paths) ? args.paths : []) {
    const safe = resolveSafePath(workspace.path, requested, { operation: 'read' });
    if (index.fileByPath.has(safe.relativePath)) seeds.add(safe.relativePath);
  }
  if (!seeds.size) for (const reference of references.items) if (!reference.test) seeds.add(reference.path);
  if (!seeds.size) throw new Error('impact requires a recognized symbol definition or at least one indexed path.');

  const impacted = new Map([...seeds].map(seed => [seed, { path: seed, depth: 0, reason: 'seed' }]));
  let frontier = [...seeds];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const next = [];
    for (const current of frontier) {
      for (const importer of index.reverseImports.get(current) || []) {
        if (impacted.has(importer)) continue;
        impacted.set(importer, { path: importer, depth, reason: `imports:${current}` });
        next.push(importer);
      }
    }
    frontier = next;
  }
  for (const reference of references.items) {
    if (!impacted.has(reference.path)) impacted.set(reference.path, { path: reference.path, depth: 1, reason: `references:${simpleSymbol(symbol)}` });
  }
  const impactedPaths = [...impacted.values()].sort((left, right) => left.depth - right.depth || left.path.localeCompare(right.path));
  const affectedTests = impactedPaths.filter(item => index.fileByPath.get(item.path)?.test).map(item => item.path);
  const importEdges = [];
  for (const item of impactedPaths) {
    for (const target of index.imports.get(item.path) || []) if (impacted.has(target)) importEdges.push({ from: item.path, to: target });
  }
  return {
    definitions,
    references: references.items,
    referenceCount: references.referenceCount,
    calls: references.items.filter(item => item.classification === 'call'),
    seeds: [...seeds],
    maxDepth,
    impactedPaths: impactedPaths.slice(0, maxResults),
    impactedPathCount: impactedPaths.length,
    affectedTests: [...new Set(affectedTests)].slice(0, maxResults),
    importEdges: importEdges.slice(0, maxResults),
    truncated: impactedPaths.length > maxResults || importEdges.length > maxResults || references.truncated,
    next: affectedTests.length ? 'Run the listed tests or relai_run_checks at the appropriate level before completion.' : 'No directly connected test file was identified; use diagnostics to review available validation commands.'
  };
}

function diagnosticReadiness(workspace, index) {
  const discovered = discoverCommands(workspace.path);
  const diagnosticCommands = Object.entries(discovered)
    .filter(([key, command]) => /(?:typecheck|lint|check|analy|vet|clippy|doctor)/i.test(`${key} ${command}`))
    .map(([key, command]) => ({ key, command }));
  return {
    languages: index.languages,
    diagnosticCommands,
    validationCommands: {
      quick: detectVerifyChecks(workspace.path, 'quick'),
      standard: detectVerifyChecks(workspace.path, 'standard'),
      release: detectVerifyChecks(workspace.path, 'release')
    },
    configuredTestCommands: Object.entries(workspace.testCommands || {}).map(([key, command]) => ({ key, command })),
    diagnosticsExecuted: false,
    next: diagnosticCommands.length ? 'Run relai_run_checks with level quick, standard, or release to execute diagnostics.' : 'No dedicated language diagnostic command was detected; configure a check, lint, typecheck, analyze, vet, or clippy command.'
  };
}

function indexMetadata(loaded, workspace) {
  return {
    mode: 'live-fingerprint-cache',
    persistent: false,
    freshness: 'current',
    cacheHit: loaded.cacheHit,
    fingerprint: loaded.fingerprint,
    builtAt: loaded.index.builtAt,
    checkedAt: loaded.checkedAt,
    newestSourceMtime: loaded.newestMtimeMs ? new Date(loaded.newestMtimeMs).toISOString() : null,
    sourceFileCount: loaded.index.sourceFileCount,
    discoveredFileCount: loaded.index.discoveredFileCount,
    indexedBytes: loaded.index.indexedBytes,
    skippedLargeFiles: loaded.index.skippedLargeFiles,
    collectionSkippedCount: loaded.index.collectionSkippedCount,
    truncated: loaded.treeTruncated || loaded.index.contentTruncated,
    policy: 'Recomputed when any indexed source path, size, or modification time changes.',
    workspace: workspace.alias
  };
}

function isTestPath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/').toLowerCase();
  const leaf = path.posix.basename(normalized);
  return normalized.includes('/test/') || normalized.includes('/tests/') || normalized.includes('/__tests__/')
    || /(?:^|[._-])(?:test|spec)(?:[._-]|$)/.test(leaf) || /_test\.(?:go|py)$/.test(leaf) || /^test_.*\.py$/.test(leaf);
}

function queryTerms(query) {
  const expanded = String(query).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^A-Za-z0-9_$]+/g, ' ').toLowerCase();
  return [...new Set(expanded.split(/\s+/).filter(term => term.length >= 2))].slice(0, 20);
}

function simpleSymbol(symbol) {
  return String(symbol).split(/[.:#-]/).filter(Boolean).at(-1) || String(symbol);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { relaiCodeInspect, isTestPath };
