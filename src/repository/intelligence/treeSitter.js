import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'web-tree-sitter';

import { languageForPath, lexicalSearchText, stripQuotes, wasmForLanguage } from './languages.js';

const WASM_ROOT = path.join(path.dirname(fileURLToPath(import.meta.resolve('tree-sitter-wasms/package.json'))), 'out');
const languageCache = new Map();
let initPromise = null;

const DEFINITION_TYPES = new Map([
  ['function_declaration', 'function'], ['function_definition', 'function'], ['function_item', 'function'],
  ['method_definition', 'method'], ['method_declaration', 'method'], ['method_definition_item', 'method'],
  ['class_declaration', 'class'], ['class_definition', 'class'], ['class_specifier', 'class'],
  ['interface_declaration', 'interface'], ['interface_definition', 'interface'],
  ['struct_item', 'struct'], ['struct_specifier', 'struct'], ['struct_declaration', 'struct'],
  ['enum_declaration', 'enum'], ['enum_specifier', 'enum'], ['enum_item', 'enum'],
  ['trait_item', 'trait'], ['type_item', 'type'], ['type_alias_declaration', 'type'], ['type_definition', 'type'],
  ['module_declaration', 'module'], ['namespace_definition', 'namespace'], ['namespace_declaration', 'namespace'],
  ['const_item', 'constant'], ['static_item', 'variable'], ['variable_declarator', 'variable']
]);

const SCOPE_KINDS = new Set(['function', 'method', 'class', 'interface', 'struct', 'trait', 'module', 'namespace']);
const CALL_TYPES = new Set(['call_expression', 'call', 'method_invocation', 'invocation_expression', 'function_call_expression']);
const IMPORT_TYPES = new Set([
  'import_statement', 'import_declaration', 'import_from_statement', 'from_import_statement', 'import_clause',
  'use_declaration', 'using_directive', 'preproc_include', 'require_expression'
]);
const IDENTIFIER_TYPES = new Set([
  'identifier', 'property_identifier', 'field_identifier', 'type_identifier', 'namespace_identifier',
  'constant', 'constant_identifier', 'simple_identifier'
]);

async function initTreeSitter() {
  if (!initPromise) initPromise = Parser.init();
  await initPromise;
}

async function loadLanguage(language) {
  const key = String(language || '').toLowerCase();
  const wasmName = wasmForLanguage(key);
  if (!wasmName) return null;
  if (!languageCache.has(key)) {
    languageCache.set(key, (async () => {
      await initTreeSitter();
      const wasmFile = path.join(WASM_ROOT, wasmName);
      if (!fs.existsSync(wasmFile)) return null;
      return Parser.Language.load(wasmFile);
    })().catch(() => null));
  }
  return languageCache.get(key);
}

async function parseSourceFile({ relativePath, source }) {
  const normalizedPath = String(relativePath || '').replaceAll('\\', '/');
  const text = String(source || '');
  const language = languageForPath(normalizedPath);
  const grammar = await loadLanguage(language);
  if (!grammar) return lexicalOnlyResult(normalizedPath, language, text, 'lexical');

  const parser = new Parser();
  try {
    parser.setLanguage(grammar);
    const tree = parser.parse(text);
    const facts = extractFacts(tree.rootNode, language);
    return {
      path: normalizedPath,
      language,
      parser: 'tree-sitter',
      parseError: Boolean(tree.rootNode.hasError),
      symbols: facts.symbols,
      occurrences: facts.occurrences,
      imports: facts.imports,
      searchText: lexicalSearchText(normalizedPath, text, facts.symbols)
    };
  } catch {
    return lexicalOnlyResult(normalizedPath, language, text, 'lexical-fallback');
  } finally {
    try { parser.delete(); } catch {}
  }
}

function lexicalOnlyResult(relativePath, language, source, parser = 'lexical') {
  return {
    path: relativePath,
    language,
    parser,
    parseError: false,
    symbols: [],
    occurrences: [],
    imports: [],
    searchText: lexicalSearchText(relativePath, source, [])
  };
}

function extractFacts(root, language) {
  const symbols = [];
  const occurrences = [];
  const imports = [];
  const definitionRanges = new Set();
  const callRanges = new Set();
  const importRanges = new Set();
  const stack = [{ node: root, scope: [] }];

  while (stack.length) {
    const { node, scope } = stack.pop();
    const kind = definitionKind(node);
    const nameNode = kind ? definitionNameNode(node) : null;
    const definition = kind && nameNode ? buildSymbol(node, nameNode, kind, scope) : null;
    if (definition) {
      symbols.push(definition);
      definitionRanges.add(rangeKey(nameNode));
    }

    if (IMPORT_TYPES.has(node.type)) {
      importRanges.add(rangeKey(node));
      for (const specifier of importSpecifiers(node, language)) {
        if (specifier) imports.push({ specifier, kind: node.type });
      }
    }

    if (CALL_TYPES.has(node.type)) {
      const target = callTargetNode(node);
      const name = simpleIdentifierText(target?.text || '');
      if (target && name) {
        callRanges.add(rangeKey(target));
        occurrences.push({ ...location(target), name, role: 'call', enclosingQualifiedName: scope.at(-1) || null });
      }
    }

    const nextScope = definition && SCOPE_KINDS.has(definition.kind) ? [...scope, definition.qualifiedName] : scope;
    const children = namedChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push({ node: children[index], scope: nextScope });
  }

  const identifierStack = [root];
  while (identifierStack.length) {
    const node = identifierStack.pop();
    if (IDENTIFIER_TYPES.has(node.type) && !definitionRanges.has(rangeKey(node)) && !callRanges.has(rangeKey(node)) && !insideImport(node, importRanges)) {
      const name = simpleIdentifierText(node.text);
      if (name) occurrences.push({ ...location(node), name, role: 'reference', enclosingQualifiedName: nearestDefinitionQualifiedName(node, symbols) });
    }
    for (const child of namedChildren(node)) identifierStack.push(child);
  }

  return {
    symbols: dedupe(symbols, item => `${item.qualifiedName}:${item.startLine}:${item.startColumn}`),
    occurrences: dedupe(occurrences, item => `${item.name}:${item.role}:${item.line}:${item.column}`),
    imports: dedupe(imports, item => `${item.kind}:${item.specifier}`)
  };
}

function definitionKind(node) {
  const kind = DEFINITION_TYPES.get(node.type);
  if (!kind) return null;
  if (node.type === 'variable_declarator' && !isModuleLevel(node)) return null;
  return kind;
}

function definitionNameNode(node) {
  for (const field of ['name', 'declarator']) {
    try {
      const child = node.childForFieldName(field);
      if (child) {
        if (IDENTIFIER_TYPES.has(child.type)) return child;
        const nested = firstIdentifier(child);
        if (nested) return nested;
      }
    } catch {}
  }
  return firstIdentifier(node);
}

function buildSymbol(node, nameNode, kind, scope) {
  const name = simpleIdentifierText(nameNode.text);
  if (!name) return null;
  const parentQualified = scope.at(-1) || '';
  const qualifiedName = parentQualified ? `${parentQualified}.${name}` : name;
  return {
    name,
    qualifiedName,
    kind,
    ...rangeLocation(node),
    nameLine: nameNode.startPosition.row + 1,
    nameColumn: nameNode.startPosition.column + 1,
    provider: 'tree-sitter',
    confidence: node.hasError ? 0.7 : 0.88
  };
}

function callTargetNode(node) {
  for (const field of ['function', 'name']) {
    try {
      const child = node.childForFieldName(field);
      if (child) return child;
    } catch {}
  }
  return namedChildren(node)[0] || null;
}

function importSpecifiers(node, language) {
  const values = [];
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (current !== node && /(?:string|system_lib_string|string_literal)$/.test(current.type)) {
      const value = stripQuotes(current.text);
      if (value) values.push(value);
    }
    for (const child of namedChildren(current)) stack.push(child);
  }
  if (values.length) return [...new Set(values)];

  const text = String(node.text || '').trim().replace(/;$/, '');
  if (language === 'python') {
    const from = text.startsWith('from ') ? text.slice(5).split(/\s+import\s+/)[0] : '';
    if (from) return [from.trim()];
  }
  if (language === 'rust' && text.startsWith('use ')) return [text.slice(4).trim()];
  if (['java', 'kotlin'].includes(language) && text.startsWith('import ')) return [text.slice(7).replace(/\s+as\s+.*$/, '').trim()];
  if (language === 'csharp' && text.startsWith('using ')) return [text.slice(6).split('=')[0].trim()];
  return [];
}

function insideImport(node, importRanges) {
  let current = node.parent;
  let depth = 0;
  while (current && depth < 8) {
    if (importRanges.has(rangeKey(current))) return true;
    current = current.parent;
    depth += 1;
  }
  return false;
}

function nearestDefinitionQualifiedName(node, symbols) {
  const row = node.startPosition.row + 1;
  let best = null;
  for (const symbol of symbols) {
    if (symbol.startLine <= row && symbol.endLine >= row) {
      if (!best || (symbol.endLine - symbol.startLine) < (best.endLine - best.startLine)) best = symbol;
    }
  }
  return best?.qualifiedName || null;
}

function isModuleLevel(node) {
  let current = node.parent;
  while (current) {
    if (['program', 'module', 'source_file', 'translation_unit'].includes(current.type)) return true;
    if (DEFINITION_TYPES.has(current.type)) return false;
    current = current.parent;
  }
  return true;
}

function firstIdentifier(node) {
  const queue = [...namedChildren(node)];
  while (queue.length) {
    const current = queue.shift();
    if (IDENTIFIER_TYPES.has(current.type)) return current;
    queue.push(...namedChildren(current));
  }
  return null;
}

function namedChildren(node) {
  try { return Array.from(node.namedChildren || []); } catch { return []; }
}

function simpleIdentifierText(value) {
  const text = String(value || '').trim();
  const parts = text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
  return parts.at(-1) || '';
}

function location(node) {
  return {
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1
  };
}

function rangeLocation(node) {
  return {
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1
  };
}

function rangeKey(node) {
  return `${node.startIndex}:${node.endIndex}`;
}

function dedupe(items, keyFn) {
  const seen = new Set();
  return items.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export { loadLanguage, parseSourceFile };