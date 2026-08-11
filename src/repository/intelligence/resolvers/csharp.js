import { dedupeRelations, importBindingMap, nearestSymbolByOffset, relation, simpleName, splitTypeList } from './common.js';

const PROVIDER = 'resolver-csharp-v1';
const CAPABILITIES = Object.freeze(['import-bindings', 'inheritance', 'interfaces', 'constructor-types', 'static-calls']);
const csharpResolver = Object.freeze({ id: PROVIDER, capabilities: CAPABILITIES, enrich({ source, facts }) {
  const text = String(source || ''); const imports = parseImports(text); const bindings = importBindingMap(imports); const symbols = facts.symbols || [];
  return { provider: PROVIDER, capabilities: CAPABILITIES, imports: imports.map(({ bindings: _bindings, ...item }) => ({ ...item, provider: PROVIDER, confidence: 0.96 })), relations: dedupeRelations([...classRelations(text, symbols, bindings), ...constructorRelations(text, symbols, bindings), ...callRelations(text, symbols, bindings)]) };
}});
function parseImports(source) {
  const result = [];
  for (const match of source.matchAll(/^\s*using\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\s*;/gm)) { const imported = simpleName(match[2]); result.push({ specifier: match[2].replaceAll('.', '/'), kind: 'using-alias', bindings: [{ local: match[1], imported, kind: 'named' }] }); }
  for (const match of source.matchAll(/^\s*using\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\s*;/gm)) result.push({ specifier: match[1].replaceAll('.', '/'), kind: 'using', bindings: [] });
  return result;
}
function classRelations(source, symbols, bindings) {
  const result = [];
  for (const match of source.matchAll(/\b(class|interface)\s+([A-Za-z_]\w*)[^:{]*:\s*([^\{]+)\{/g)) {
    const owner = symbols.find(item => item.name === match[2])?.qualifiedName || match[2]; const targets = splitTypeList(match[3]);
    targets.forEach((target, index) => result.push(relation(PROVIDER, match[1] === 'interface' || index === 0 ? 'INHERITS' : 'IMPLEMENTS', owner, target, bindings, { confidence: 0.96 })));
  }
  return result;
}
function constructorRelations(source, symbols, bindings) { const result=[]; for(const match of source.matchAll(/\bnew\s+([A-Z][A-Za-z0-9_]*)\s*\(/g)) result.push(relation(PROVIDER,'USES_TYPE',nearestSymbolByOffset(source,symbols,match.index||0),match[1],bindings,{confidence:0.95})); return result; }
function callRelations(source, symbols, bindings) { const result=[]; for(const match of source.matchAll(/\b([A-Z][A-Za-z0-9_]*)\.([A-Za-z_]\w*)\s*\(/g)){const item=bindings.get(match[1]);if(item)result.push(relation(PROVIDER,'CALLS',nearestSymbolByOffset(source,symbols,match.index||0),match[2],new Map(),{moduleSpecifier:item.specifier,targetQualifiedName:simpleName(item.imported)+'.'+match[2],confidence:0.94}));} return result; }
export { csharpResolver };
