'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { collectTextFiles, collectOptionsFromWorkspace, resolveSafePath, isPathInside, realRootOf } = require('../safety');
const { discoverCommands } = require('../commandDiscovery');
const { detectVerifyChecks } = require('./checkDetection');
const { clampNumber } = require('./limits');
const { EXTENSION_LANGUAGE, MAX_LINE_CHARS, buildIndex, escapeRegExp, isTestPath } = require('./codeIndex');

const CACHE = new Map();
const DEFAULT_MAX_RESULTS = 200;
const DEFAULT_MAX_FILES = 5000;

async function relaiCodeInspect(workspace, _config, args = {}) {
  const action = String(args.action || '').trim().toLowerCase();
  if (!['symbol', 'references', 'related', 'impact', 'trace', 'diagnostics'].includes(action)) {
    throw new Error('relai_code_inspect action must be one of: symbol, references, related, impact, trace, diagnostics.');
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
  const impact = impactAnalysis(workspace, loaded.index, symbol, definitions, references, args, maxResults);
  if (action === 'trace') return { ...base, symbol, ...traceAnalysis(loaded.index, symbol, definitions, references, impact, maxResults) };
  return { ...base, ...(symbol ? { symbol } : {}), ...impact };
}

function emptyReferences() {
  return { items: [], matchCount: 0, referenceCount: 0, callCount: 0, truncated: false };
}

function loadIndex(workspace, args) {
  const maxFiles = Math.floor(clampNumber(args.maxFiles, 1, 20000, DEFAULT_MAX_FILES));
  // collectTextFiles already resolves each entry through realpath, rejects anything
  // outside the root, and drops sensitive paths. Re-running resolveSafePath per file
  // here repeated that work ~277 times per call (212ms of a 330ms cache hit), so this
  // loop keeps the boundary assertion but reuses the root realpath instead.
  const realRoot = realRootOf(workspace.path);
  const tree = collectTextFiles(workspace.path, collectOptionsFromWorkspace(workspace, { maxEntries: maxFiles }));
  const candidates = [];
  let newestMtimeMs = 0;
  // Hash incrementally instead of materializing one joined string for every indexed
  // file — on a large repository that allocation was larger than the digest itself.
  const fingerprintHash = crypto.createHash('sha256');
  for (const relativePath of tree.files) {
    if (!EXTENSION_LANGUAGE.has(path.extname(relativePath).toLowerCase())) continue;
    try {
      const absolutePath = path.resolve(realRoot, relativePath);
      if (!isPathInside(absolutePath, realRoot)) continue;
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile()) continue;
      newestMtimeMs = Math.max(newestMtimeMs, stat.mtimeMs);
      const normalizedPath = relativePath.replaceAll('\\', '/');
      fingerprintHash.update(`${normalizedPath}:${stat.size}:${stat.mtimeMs}\n`);
      candidates.push({ path: normalizedPath, absolutePath, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch {}
  }
  const fingerprint = fingerprintHash.digest('hex');
  const key = realRoot;
  const cached = CACHE.get(key);
  if (cached?.fingerprint === fingerprint) {
    return { index: cached.index, fingerprint, cacheHit: true, checkedAt: new Date().toISOString(), treeTruncated: tree.truncated, newestMtimeMs };
  }
  const index = buildIndex(candidates, tree);
  CACHE.set(key, { fingerprint, index });
  return { index, fingerprint, cacheHit: false, checkedAt: new Date().toISOString(), treeTruncated: tree.truncated, newestMtimeMs };
}

function fileMayContainTerm(file, term) {
  for (const token of file.lowerTokens) {
    if (token.includes(term)) return true;
  }
  return false;
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
    // A file without the exact word token cannot satisfy the word-boundary matcher.
    if (!file.identifiers.has(simple)) continue;
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
      // Skip the per-line scan entirely when no token in the file can contain the term.
      if (snippets.length < 3 && fileMayContainTerm(file, term)) {
        for (let indexLine = 0; indexLine < file.lines.length && snippets.length < 3; indexLine += 1) {
          if (file.lines[indexLine].toLowerCase().includes(term)) snippets.push({ line: indexLine + 1, text: file.lines[indexLine].trim().slice(0, MAX_LINE_CHARS) });
        }
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

function traceAnalysis(index, symbol, definitions, references, impact, maxResults) {
  const definitionPaths = new Set(definitions.map(item => item.path));
  const directCallers = references.items.filter(item => item.classification === 'call');
  const importers = references.items.filter(item => item.classification === 'import');
  const relatedSymbols = [];
  for (const item of definitions) {
    const file = index.fileByPath.get(item.path);
    if (!file) continue;
    for (const candidate of file.definitions) {
      if (candidate.name === simpleSymbol(symbol)) continue;
      relatedSymbols.push({ path: candidate.path, line: candidate.line, name: candidate.name, kind: candidate.kind, reason: 'same-definition-file' });
    }
  }
  const uiSurfaces = impact.impactedPaths
    .filter(item => /(?:^|\/)(?:ui|electron|public|renderer|components?|features?)(?:\/|$)/i.test(item.path))
    .slice(0, maxResults);
  const testSurfaces = impact.affectedTests.slice(0, maxResults);
  const registrationSurfaces = impact.impactedPaths
    .filter(item => /(?:registry|schema|handlers|tools|routes?|mcpServer|http)/i.test(item.path))
    .slice(0, maxResults);
  const recommendedReadOrder = [
    ...definitions.map(item => item.path),
    ...importers.map(item => item.path),
    ...directCallers.map(item => item.path),
    ...registrationSurfaces.map(item => item.path),
    ...testSurfaces
  ].filter((value, indexPosition, values) => value && values.indexOf(value) === indexPosition).slice(0, maxResults);
  return {
    definitions,
    definitionPaths: [...definitionPaths],
    directCallers: directCallers.slice(0, maxResults),
    importers: importers.slice(0, maxResults),
    references: references.items.slice(0, maxResults),
    indirectImpact: impact.impactedPaths.slice(0, maxResults),
    importEdges: impact.importEdges.slice(0, maxResults),
    relatedSymbols: relatedSymbols.slice(0, maxResults),
    affectedTests: testSurfaces,
    uiSurfaces,
    registrationSurfaces,
    recommendedReadOrder,
    summary: {
      definitions: definitions.length,
      directCalls: directCallers.length,
      imports: importers.length,
      impactedPaths: impact.impactedPathCount,
      affectedTests: impact.affectedTests.length
    },
    truncated: impact.truncated || relatedSymbols.length > maxResults,
    next: 'Read recommendedReadOrder in sequence; validate affectedTests after the final mutation.'
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

function queryTerms(query) {
  const expanded = String(query).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^A-Za-z0-9_$]+/g, ' ').toLowerCase();
  return [...new Set(expanded.split(/\s+/).filter(term => term.length >= 2))].slice(0, 20);
}

function simpleSymbol(symbol) {
  return String(symbol).split(/[.:#-]/).filter(Boolean).at(-1) || String(symbol);
}

module.exports = { relaiCodeInspect, isTestPath, loadIndex };
