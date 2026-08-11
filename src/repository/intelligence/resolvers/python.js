import { dedupeRelations, importBindingMap, nearestSymbolByOffset, relation, simpleName, splitTypeList } from './common.js';

const PROVIDER = 'resolver-python-v1';
const CAPABILITIES = Object.freeze(['import-bindings', 'inheritance', 'constructor-types', 'imported-calls']);

const pythonResolver = Object.freeze({
  id: PROVIDER,
  capabilities: CAPABILITIES,
  enrich({ source, facts }) {
    const text = String(source || '');
    const imports = parseImports(text);
    const bindings = importBindingMap(imports);
    const symbols = facts.symbols || [];
    return {
      provider: PROVIDER,
      capabilities: CAPABILITIES,
      imports: imports.map(({ bindings: _bindings, ...item }) => ({ ...item, provider: PROVIDER, confidence: 0.96 })),
      relations: dedupeRelations([
        ...inheritanceRelations(text, symbols, bindings),
        ...constructorRelations(text, symbols, bindings),
        ...callRelations(text, symbols, bindings)
      ])
    };
  }
});

function parseImports(source) {
  const imports = [];
  for (const match of source.matchAll(/^\s*from\s+([.A-Za-z_][\w.]*)\s+import\s+([^\n#]+)/gm)) {
    const specifier = pythonSpecifier(match[1]);
    const bindings = match[2].replace(/[()]/g, '').split(',').map(part => binding(part)).filter(Boolean);
    imports.push({ specifier, kind: 'from-import', bindings });
  }
  for (const match of source.matchAll(/^\s*import\s+([^\n#]+)/gm)) {
    for (const raw of match[1].split(',')) {
      const parts = raw.trim().split(/\s+as\s+/);
      const imported = parts[0]?.trim();
      if (!imported) continue;
      const local = simpleName(parts[1] || imported);
      imports.push({ specifier: pythonSpecifier(imported), kind: 'import', bindings: [{ local, imported: '*', kind: 'namespace' }] });
    }
  }
  return imports;
}

function binding(value) {
  const parts = String(value || '').trim().split(/\s+as\s+/);
  const imported = simpleName(parts[0]);
  const local = simpleName(parts[1] || parts[0]);
  return imported && local ? { local, imported, kind: 'named' } : null;
}

function pythonSpecifier(value) {
  const raw = String(value || '').trim();
  const dots = raw.match(/^\.+/)?.[0].length || 0;
  const body = raw.slice(dots).replaceAll('.', '/');
  if (!dots) return body;
  const prefix = dots === 1 ? './' : '../'.repeat(dots - 1);
  return `${prefix}${body}`.replace(/\/$/, '');
}

function inheritanceRelations(source, symbols, bindings) {
  const result = [];
  for (const match of source.matchAll(/\bclass\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/g)) {
    const owner = symbols.find(item => item.name === match[1])?.qualifiedName || match[1];
    for (const base of splitTypeList(match[2])) result.push(relation(PROVIDER, 'INHERITS', owner, base, bindings, { confidence: 0.97 }));
  }
  return result;
}

function constructorRelations(source, symbols, bindings) {
  const result = [];
  for (const match of source.matchAll(/\b([A-Za-z_]\w*)\s*=\s*([A-Z][A-Za-z0-9_]*)\s*\(/g)) {
    const owner = nearestSymbolByOffset(source, symbols, match.index || 0);
    result.push(relation(PROVIDER, 'USES_TYPE', owner, match[2], bindings, { sourceName: match[1], confidence: 0.94 }));
  }
  return result;
}

function callRelations(source, symbols, bindings) {
  const result = [];
  for (const match of source.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    if (!bindings.has(match[1])) continue;
    const owner = nearestSymbolByOffset(source, symbols, match.index || 0);
    result.push(relation(PROVIDER, 'CALLS', owner, match[1], bindings, { confidence: 0.95 }));
  }
  for (const match of source.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/g)) {
    const imported = bindings.get(match[1]);
    if (!imported || imported.imported !== '*') continue;
    const owner = nearestSymbolByOffset(source, symbols, match.index || 0);
    result.push(relation(PROVIDER, 'CALLS', owner, match[2], new Map(), { moduleSpecifier: imported.specifier, targetQualifiedName: match[2], confidence: 0.95 }));
  }
  return result;
}

export { pythonResolver };
