import { dedupeRelations, descendantsOfTypes, importBindingMap, nodeText, nodesOfTypes, relation, simpleName, symbolForNode } from './common.js';
import { frameworkRelations } from './frameworks.js';

const PROVIDER = 'resolver-kotlin-v2';
const CAPABILITIES = Object.freeze(['ast-import-bindings', 'ast-inheritance', 'ast-interfaces', 'ast-constructor-types', 'ast-imported-calls', 'framework-http']);
const kotlinResolver = Object.freeze({ id: PROVIDER, capabilities: CAPABILITIES, enrich({ root, facts, language }) {
  const imports = parseImports(root); const bindings = importBindingMap(imports); const symbols = facts.symbols || [];
  return { provider: PROVIDER, capabilities: CAPABILITIES, imports: enrichImports(imports), relations: dedupeRelations([
    ...classRelations(root, symbols, bindings), ...callAndConstructorRelations(root, symbols, bindings), ...frameworkRelations(language, { root, symbols, provider: PROVIDER })
  ]) };
}});
function parseImports(root) {
  const result = [];
  for (const node of nodesOfTypes(root, ['import_header'])) {
    const text = nodeText(node).replace(/^import\s+/, '').trim(); const aliasMatch = text.match(/\s+as\s+([A-Za-z_]\w*)$/); const qualified = text.replace(/\s+as\s+.*$/, ''); const parts = qualified.split('.'); const imported = parts.at(-1); if (!imported) continue;
    result.push({ specifier: qualified.replaceAll('.', '/'), kind: 'import', bindings: [{ local: aliasMatch?.[1] || imported, imported, kind: 'named' }] });
  }
  return result;
}
function classRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['class_declaration'])) {
    const className = descendantsOfTypes(node, ['type_identifier'])[0]; const name = simpleName(nodeText(className)); const owner = symbols.find(item => item.name === name)?.qualifiedName || name;
    for (const spec of descendantsOfTypes(node, ['delegation_specifier'])) {
      const constructor = descendantsOfTypes(spec, ['constructor_invocation'])[0]; const type = descendantsOfTypes(spec, ['type_identifier'])[0]; if (!type) continue;
      result.push(relation(PROVIDER, constructor ? 'INHERITS' : 'IMPLEMENTS', owner, nodeText(type), bindings, { confidence: 0.97 }));
    }
  }
  return result;
}
function callAndConstructorRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['call_expression'])) {
    const text = nodeText(node); const name = text.match(/^([A-Za-z_]\w*)\s*\(/)?.[1]; if (!name) continue;
    const imported = bindings.get(name); if (imported && /^[a-z]/.test(name)) result.push(relation(PROVIDER, 'CALLS', symbolForNode(node, symbols), name, bindings, { confidence: 0.97 }));
    if (/^[A-Z]/.test(name)) result.push(relation(PROVIDER, 'USES_TYPE', symbolForNode(node, symbols), name, bindings, { confidence: 0.96 }));
  }
  return result;
}
function enrichImports(imports) { return imports.map(({ bindings: _bindings, ...item }) => ({ ...item, provider: PROVIDER, confidence: 0.97 })); }
export { kotlinResolver };
