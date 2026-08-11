import { dedupeRelations, descendantsOfTypes, fieldNode, importBindingMap, namedChildren, nodeText, nodesOfTypes, relation, simpleName, symbolForNode } from './common.js';
import { frameworkRelations } from './frameworks.js';

const PROVIDER = 'resolver-java-v2';
const CAPABILITIES = Object.freeze(['ast-import-bindings', 'ast-inheritance', 'ast-interfaces', 'ast-constructor-types', 'ast-imported-calls', 'framework-http']);
const javaResolver = Object.freeze({ id: PROVIDER, capabilities: CAPABILITIES, enrich({ root, facts, language }) {
  const imports = parseImports(root); const bindings = importBindingMap(imports); const symbols = facts.symbols || [];
  return { provider: PROVIDER, capabilities: CAPABILITIES, imports: enrichImports(imports), relations: dedupeRelations([
    ...classRelations(root, symbols, bindings), ...constructorRelations(root, symbols, bindings), ...callRelations(root, symbols, bindings),
    ...frameworkRelations(language, { root, symbols, provider: PROVIDER })
  ]) };
}});

function parseImports(root) {
  const result = [];
  for (const node of nodesOfTypes(root, ['import_declaration'])) {
    const text = nodeText(node); const staticImport = /^import\s+static\s+/.test(text);
    const qualified = text.replace(/^import\s+/, '').replace(/^static\s+/, '').replace(/;$/, '').trim();
    const parts = qualified.split('.'); const imported = parts.pop(); if (!imported) continue;
    if (staticImport) {
      const owner = parts.pop(); result.push({ specifier: [...parts, owner].join('/'), kind: 'static-import', bindings: [{ local: imported, imported, kind: 'static' }] });
    } else result.push({ specifier: [...parts, imported].join('/'), kind: 'import', bindings: [{ local: imported, imported, kind: 'named' }] });
  }
  return result;
}

function classRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['class_declaration', 'interface_declaration'])) {
    const name = simpleName(nodeText(fieldNode(node, 'name'))); const owner = symbols.find(item => item.name === name)?.qualifiedName || name;
    const superclass = fieldNode(node, 'superclass');
    for (const type of descendantsOfTypes(superclass, ['type_identifier'])) result.push(relation(PROVIDER, 'INHERITS', owner, nodeText(type), bindings, { confidence: 0.98 }));
    const interfaces = fieldNode(node, 'interfaces');
    const typeList = descendantsOfTypes(interfaces, ['type_list'])[0];
    for (const type of namedChildren(typeList || interfaces)) result.push(relation(PROVIDER, node.type === 'interface_declaration' ? 'INHERITS' : 'IMPLEMENTS', owner, nodeText(type), bindings, { confidence: 0.98 }));
  }
  return result;
}

function constructorRelations(root, symbols, bindings) {
  return nodesOfTypes(root, ['object_creation_expression']).map(node => relation(PROVIDER, 'USES_TYPE', symbolForNode(node, symbols), nodeText(fieldNode(node, 'type')), bindings, { confidence: 0.97 }));
}
function callRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['method_invocation'])) {
    const name = simpleName(nodeText(fieldNode(node, 'name'))); const text = nodeText(node); const direct = bindings.get(name);
    if (direct?.kind === 'static') result.push(relation(PROVIDER, 'CALLS', symbolForNode(node, symbols), name, bindings, { confidence: 0.97 }));
    const receiver = text.match(/^([A-Z][A-Za-z0-9_$]*)\s*\./)?.[1]; const imported = receiver ? bindings.get(receiver) : null;
    if (imported) result.push(relation(PROVIDER, 'CALLS', symbolForNode(node, symbols), name, new Map(), { moduleSpecifier: imported.specifier, targetQualifiedName: `${simpleName(imported.imported)}.${name}`, confidence: 0.96 }));
  }
  return result;
}
function enrichImports(imports) { return imports.map(({ bindings: _bindings, ...item }) => ({ ...item, provider: PROVIDER, confidence: 0.97 })); }
export { javaResolver };
