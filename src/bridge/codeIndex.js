

// Construction of the in-memory code index: read each candidate file once and derive
// the definitions, imports, and lookup tokens the query side needs.
//
// Split out of codeIntelligence.js so that file covers only the query actions (symbol,
// references, related, impact, diagnostics). Nothing here touches the workspace beyond
// reading files the caller already validated and stat-ed.

import * as fs from "node:fs";
import * as path from "node:path";
import { looksBinary } from "../safety.js";

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
      const tokens = extractTokens(text);
      const file = {
        path: candidate.path,
        language,
        test: isTestPath(candidate.path),
        text,
        lines,
        definitions,
        imports: [],
        identifiers: tokens.identifiers,
        lowerTokens: tokens.lowerTokens
      };
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

// Reference and relatedness queries used to regex every line of every indexed file.
// Two per-file token sets, built once while the file is already in memory, let those
// queries skip whole files up front:
//   identifiers — exact word tokens, so a symbol lookup only line-scans files that
//     actually contain that word (leading digits are stripped so "9foo" still yields
//     "foo", keeping the set a superset of what the word-boundary regex can match);
//   lowerTokens — lowercased alphanumeric runs, a superset of any substring a query
//     term can match, so a related-files term only line-scans plausible files.
function extractTokens(text) {
  const identifiers = new Set();
  const lowerTokens = new Set();
  for (const run of text.match(/[A-Za-z0-9_$]+/g) || []) {
    lowerTokens.add(run.toLowerCase());
    const identifier = run.replace(/^\d+/, '');
    if (identifier) identifiers.add(identifier);
  }
  return { identifiers, lowerTokens };
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

function isTestPath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/').toLowerCase();
  const leaf = path.posix.basename(normalized);
  return normalized.startsWith('test/') || normalized.startsWith('tests/') || normalized.startsWith('__tests__/')
    || normalized.includes('/test/') || normalized.includes('/tests/') || normalized.includes('/__tests__/')
    || /(?:^|[._-])(?:test|spec)(?:[._-]|$)/.test(leaf) || /_test\.(?:go|py)$/.test(leaf) || /^test_.*\.py$/.test(leaf);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { EXTENSION_LANGUAGE, MAX_LINE_CHARS, buildIndex, escapeRegExp, isTestPath };
