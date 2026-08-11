import { dedupeRelations, descendantsOfTypes, fieldNode, namedChildren, nodeText, nodesOfTypes, relation, simpleName, stripQuotes, symbolForNode } from './common.js';

const PROVIDER = 'resolver-c-family-v2';
const CAPABILITIES = Object.freeze(['ast-includes', 'ast-inheritance', 'ast-constructor-types', 'ast-scoped-calls']);
const cFamilyResolver = Object.freeze({ id: PROVIDER, capabilities: CAPABILITIES, enrich({ root, facts, language }) {
  const symbols = facts.symbols || []; const relations = language === 'cpp' ? [...inheritanceRelations(root, symbols), ...constructorRelations(root, symbols), ...callRelations(root, symbols)] : [];
  return { provider: PROVIDER, capabilities: CAPABILITIES, imports: enrichImports(parseIncludes(root)), relations: dedupeRelations(relations) };
}});
function parseIncludes(root) {
  const result = [];
  for (const node of nodesOfTypes(root, ['preproc_include'])) {
    const pathNode = fieldNode(node, 'path'); const raw = nodeText(pathNode); const value = stripQuotes(raw.replace(/^<|>$/g, '')); if (!value) continue;
    result.push({ specifier: raw.startsWith('"') ? `./${value}` : value, kind: 'include', bindings: [] });
  }
  return result;
}
function inheritanceRelations(root, symbols) {
  const result = [];
  for (const node of nodesOfTypes(root, ['class_specifier'])) {
    const name = simpleName(nodeText(fieldNode(node, 'name'))); const owner = symbols.find(item => item.name === name)?.qualifiedName || name;
    for (const clause of descendantsOfTypes(node, ['base_class_clause'])) {
      for (const type of namedChildren(clause).filter(child => !['access_specifier'].includes(child.type))) result.push(relation(PROVIDER, 'INHERITS', owner, nodeText(type), new Map(), { confidence: 0.98 }));
    }
  }
  return result;
}
function constructorRelations(root, symbols) { return nodesOfTypes(root, ['new_expression']).map(node => relation(PROVIDER, 'USES_TYPE', symbolForNode(node, symbols), nodeText(fieldNode(node, 'type')), new Map(), { confidence: 0.96 })); }
function callRelations(root, symbols) {
  const result = [];
  for (const node of nodesOfTypes(root, ['call_expression'])) {
    const fn = fieldNode(node, 'function'); if (fn?.type !== 'qualified_identifier') continue; const text = nodeText(fn); const match = text.match(/^([A-Za-z_]\w*)::([A-Za-z_]\w*)$/);
    if (match) result.push(relation(PROVIDER, 'CALLS', symbolForNode(node, symbols), match[2], new Map(), { targetQualifiedName: `${match[1]}.${match[2]}`, confidence: 0.94 }));
  }
  return result;
}
function enrichImports(imports) { return imports.map(({ bindings: _bindings, ...item }) => ({ ...item, provider: PROVIDER, confidence: 0.98 })); }
export { cFamilyResolver };
