import { dedupeRelations, fieldNode, importBindingMap, namedChildren, nodeText, nodesOfTypes, relation, simpleName, symbolForNode } from './common.js';
import { frameworkRelations } from './frameworks.js';

const PROVIDER = 'resolver-csharp-v2';
const CAPABILITIES = Object.freeze(['ast-import-bindings', 'ast-inheritance', 'ast-interfaces', 'ast-constructor-types', 'ast-static-calls', 'framework-http']);
const csharpResolver = Object.freeze({ id: PROVIDER, capabilities: CAPABILITIES, enrich({ root, facts, language }) {
  const imports = parseImports(root); const bindings = importBindingMap(imports); const symbols = facts.symbols || [];
  return { provider: PROVIDER, capabilities: CAPABILITIES, imports: enrichImports(imports), relations: dedupeRelations([
    ...classRelations(root, symbols, bindings), ...constructorRelations(root, symbols, bindings), ...callRelations(root, symbols, bindings),
    ...frameworkRelations(language, { root, symbols, provider: PROVIDER })
  ]) };
}});
function parseImports(root) {
  const result = [];
  for (const node of nodesOfTypes(root, ['using_directive'])) {
    const text = nodeText(node).replace(/^using\s+/, '').replace(/;$/, '').trim(); const alias = text.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (alias) result.push({ specifier: alias[2].trim().replaceAll('.', '/'), kind: 'using-alias', bindings: [{ local: alias[1], imported: simpleName(alias[2]), kind: 'named' }] });
    else result.push({ specifier: text.replaceAll('.', '/'), kind: 'using', bindings: [] });
  }
  return result;
}
function classRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['class_declaration', 'interface_declaration'])) {
    const name = simpleName(nodeText(fieldNode(node, 'name'))); const owner = symbols.find(item => item.name === name)?.qualifiedName || name;
    const bases = fieldNode(node, 'bases') || namedChildren(node).find(child => child.type === 'base_list'); const types = namedChildren(bases);
    for (let index = 0; index < types.length; index += 1) result.push(relation(PROVIDER, node.type === 'interface_declaration' || index === 0 ? 'INHERITS' : 'IMPLEMENTS', owner, nodeText(types[index]), bindings, { confidence: 0.97 }));
  }
  return result;
}
function constructorRelations(root, symbols, bindings) { return nodesOfTypes(root, ['object_creation_expression']).map(node => relation(PROVIDER, 'USES_TYPE', symbolForNode(node, symbols), nodeText(fieldNode(node, 'type')), bindings, { confidence: 0.97 })); }
function callRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['invocation_expression'])) {
    const fn = fieldNode(node, 'function'); if (fn?.type !== 'member_access_expression') continue;
    const text = nodeText(fn); const match = text.match(/^([A-Z][A-Za-z0-9_]*)\.([A-Za-z_]\w*)$/); const imported = match ? bindings.get(match[1]) : null;
    if (match && imported) result.push(relation(PROVIDER, 'CALLS', symbolForNode(node, symbols), match[2], new Map(), { moduleSpecifier: imported.specifier, targetQualifiedName: `${simpleName(imported.imported)}.${match[2]}`, confidence: 0.96 }));
  }
  return result;
}
function enrichImports(imports) { return imports.map(({ bindings: _bindings, ...item }) => ({ ...item, provider: PROVIDER, confidence: 0.97 })); }
export { csharpResolver };
