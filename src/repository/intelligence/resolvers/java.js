import { dedupeRelations, importBindingMap, nearestSymbolByOffset, relation, simpleName, splitTypeList } from './common.js';

const PROVIDER = 'resolver-java-v1';
const CAPABILITIES = Object.freeze(['import-bindings', 'inheritance', 'interfaces', 'constructor-types', 'imported-calls']);
const javaResolver = Object.freeze({ id: PROVIDER, capabilities: CAPABILITIES, enrich({ source, facts }) {
  const text = String(source || ''); const imports = parseImports(text); const bindings = importBindingMap(imports); const symbols = facts.symbols || [];
  return { provider: PROVIDER, capabilities: CAPABILITIES, imports: imports.map(({ bindings: _bindings, ...item }) => ({ ...item, provider: PROVIDER, confidence: 0.96 })), relations: dedupeRelations([...classRelations(text, symbols, bindings), ...constructorRelations(text, symbols, bindings), ...callRelations(text, symbols, bindings)]) };
}});
function parseImports(source) {
  const result = [];
  for (const match of source.matchAll(/^\s*import\s+(static\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*;/gm)) {
    const parts = match[2].split('.'); const imported = parts.pop(); const staticImport = Boolean(match[1]);
    const owner = staticImport ? parts.pop() : imported; const specifier = [...parts, owner].join('/');
    result.push({ specifier, kind: staticImport ? 'static-import' : 'import', bindings: [{ local: imported, imported, kind: staticImport ? 'static' : 'named' }] });
  }
  return result;
}
function classRelations(source, symbols, bindings) {
  const result = [];
  for (const match of source.matchAll(/\b(class|interface)\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([^{]+?))?(?:\s+implements\s+([^{]+?))?\s*\{/g)) {
    const owner = symbols.find(item => item.name === match[2])?.qualifiedName || match[2];
    for (const target of splitTypeList(match[3])) result.push(relation(PROVIDER, 'INHERITS', owner, target, bindings, { confidence: 0.97 }));
    for (const target of splitTypeList(match[4])) result.push(relation(PROVIDER, 'IMPLEMENTS', owner, target, bindings, { confidence: 0.97 }));
  }
  return result;
}
function constructorRelations(source, symbols, bindings) {
  const result = [];
  for (const match of source.matchAll(/\bnew\s+([A-Z][A-Za-z0-9_$]*)\s*\(/g)) result.push(relation(PROVIDER, 'USES_TYPE', nearestSymbolByOffset(source, symbols, match.index || 0), match[1], bindings, { confidence: 0.95 }));
  return result;
}
function callRelations(source, symbols, bindings) {
  const result = [];
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) { const item = bindings.get(match[1]); if (item?.kind === 'static') result.push(relation(PROVIDER, 'CALLS', nearestSymbolByOffset(source, symbols, match.index || 0), match[1], bindings, { confidence: 0.95 })); }
  for (const match of source.matchAll(/\b([A-Z][A-Za-z0-9_$]*)\.([A-Za-z_$][\w$]*)\s*\(/g)) { const item = bindings.get(match[1]); if (item) result.push(relation(PROVIDER, 'CALLS', nearestSymbolByOffset(source, symbols, match.index || 0), match[2], new Map(), { moduleSpecifier: item.specifier, targetQualifiedName: simpleName(item.imported) + '.' + match[2], confidence: 0.94 })); }
  return result;
}
export { javaResolver };
