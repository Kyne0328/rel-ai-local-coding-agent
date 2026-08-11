import { dedupeRelations, descendantsOfTypes, fieldNode, importBindingMap, nodeText, nodesOfTypes, relation, simpleName, symbolForNode } from './common.js';
import { frameworkRelations } from './frameworks.js';

const PROVIDER = 'resolver-php-v2';
const CAPABILITIES = Object.freeze(['ast-use-bindings', 'ast-requires', 'ast-inheritance', 'ast-interfaces', 'ast-constructor-types', 'ast-imported-calls', 'framework-http']);
const phpResolver = Object.freeze({ id: PROVIDER, capabilities: CAPABILITIES, enrich({ root, facts, language }) {
  const imports = parseImports(root); const bindings = importBindingMap(imports); const symbols = facts.symbols || [];
  return { provider: PROVIDER, capabilities: CAPABILITIES, imports: enrichImports(imports), relations: dedupeRelations([
    ...classRelations(root, symbols, bindings), ...constructorRelations(root, symbols, bindings), ...callRelations(root, symbols, bindings),
    ...frameworkRelations(language, { root, symbols, provider: PROVIDER })
  ]) };
}});
function parseImports(root) {
  const result = [];
  for (const node of nodesOfTypes(root, ['namespace_use_declaration'])) {
    const text = nodeText(node).replace(/^use\s+/, '').replace(/;$/, '').trim(); const functionImport = /^function\s+/.test(text); const qualified = text.replace(/^function\s+/, '').replaceAll('\\', '/');
    const parts = qualified.split('/').filter(Boolean); const imported = parts.pop(); if (!imported) continue;
    result.push({ specifier: functionImport ? parts.join('/') : [...parts, imported].join('/'), kind: functionImport ? 'use-function' : 'use', bindings: [{ local: simpleName(imported), imported: simpleName(imported), kind: functionImport ? 'static' : 'named' }] });
  }
  for (const node of nodesOfTypes(root, ['function_call_expression'])) {
    const text = nodeText(node); const match = text.match(/^(?:require|require_once|include|include_once)\s*(?:\(\s*)?['"]([^'"]+)['"]/); if (match) result.push({ specifier: match[1], kind: 'require', bindings: [] });
  }
  return result;
}
function classRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['class_declaration', 'interface_declaration'])) {
    const name = simpleName(nodeText(fieldNode(node, 'name'))); const owner = symbols.find(item => item.name === name)?.qualifiedName || name;
    for (const base of descendantsOfTypes(node, ['base_clause'])) for (const target of descendantsOfTypes(base, ['name', 'qualified_name'])) result.push(relation(PROVIDER, 'INHERITS', owner, nodeText(target), bindings, { confidence: 0.98 }));
    for (const clause of descendantsOfTypes(node, ['class_interface_clause'])) for (const target of descendantsOfTypes(clause, ['name', 'qualified_name'])) result.push(relation(PROVIDER, node.type === 'interface_declaration' ? 'INHERITS' : 'IMPLEMENTS', owner, nodeText(target), bindings, { confidence: 0.98 }));
  }
  return result;
}
function constructorRelations(root, symbols, bindings) {
  const result = []; for (const node of nodesOfTypes(root, ['object_creation_expression'])) { const type = descendantsOfTypes(node, ['name', 'qualified_name'])[0]; if (type) result.push(relation(PROVIDER, 'USES_TYPE', symbolForNode(node, symbols), nodeText(type), bindings, { confidence: 0.97 })); } return result;
}
function callRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['function_call_expression'])) {
    const fn = fieldNode(node, 'function'); const name = simpleName(nodeText(fn)); const imported = bindings.get(name); if (imported?.kind === 'static') result.push(relation(PROVIDER, 'CALLS', symbolForNode(node, symbols), name, bindings, { confidence: 0.97 }));
  }
  for (const node of nodesOfTypes(root, ['scoped_call_expression'])) {
    const text = nodeText(node); const match = text.match(/^([A-Z][A-Za-z0-9_]*)::([A-Za-z_]\w*)/); const imported = match ? bindings.get(match[1]) : null;
    if (match && imported) result.push(relation(PROVIDER, 'CALLS', symbolForNode(node, symbols), match[2], new Map(), { moduleSpecifier: imported.specifier, targetQualifiedName: `${simpleName(imported.imported)}.${match[2]}`, confidence: 0.96 }));
  }
  return result;
}
function enrichImports(imports) { return imports.map(({ bindings: _bindings, ...item }) => ({ ...item, provider: PROVIDER, confidence: 0.97 })); }
export { phpResolver };
