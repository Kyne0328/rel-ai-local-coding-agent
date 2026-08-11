import { dedupeRelations, fieldNode, nodeText, nodesOfTypes, relation, simpleName, stripQuotes, symbolForNode } from './common.js';
import { frameworkRelations } from './frameworks.js';

const PROVIDER = 'resolver-go-v2';
const CAPABILITIES = Object.freeze(['ast-import-bindings', 'ast-package-calls', 'ast-package-types', 'framework-http']);
const goResolver = Object.freeze({ id: PROVIDER, capabilities: CAPABILITIES, enrich({ root, facts, language }) {
  const imports = parseImports(root); const aliases = new Map(); for (const item of imports) for (const binding of item.bindings || []) aliases.set(binding.local, { ...binding, specifier: item.specifier });
  const symbols = facts.symbols || [];
  return { provider: PROVIDER, capabilities: CAPABILITIES, imports: enrichImports(imports), relations: dedupeRelations([
    ...typeRelations(root, symbols, aliases), ...callRelations(root, symbols, aliases), ...frameworkRelations(language, { root, symbols, provider: PROVIDER })
  ]) };
}});
function parseImports(root) {
  const result = [];
  for (const node of nodesOfTypes(root, ['import_spec'])) {
    const pathNode = fieldNode(node, 'path'); const specifier = stripQuotes(nodeText(pathNode)); if (!specifier) continue;
    const aliasText = nodeText(fieldNode(node, 'name')); const local = aliasText && !['.', '_'].includes(aliasText) ? aliasText : simpleName(specifier.split('/').at(-1));
    result.push({ specifier, kind: 'import', bindings: local ? [{ local, imported: '*', kind: 'namespace' }] : [] });
  }
  return result;
}
function typeRelations(root, symbols, aliases) {
  const result = [];
  for (const node of nodesOfTypes(root, ['qualified_type'])) {
    const packageNode = fieldNode(node, 'package'); const nameNode = fieldNode(node, 'name'); const packageName = nodeText(packageNode); const imported = aliases.get(packageName);
    if (imported && nameNode) result.push(relation(PROVIDER, 'USES_TYPE', symbolForNode(node, symbols), nodeText(nameNode), new Map(), { moduleSpecifier: imported.specifier, targetQualifiedName: nodeText(nameNode), confidence: 0.96 }));
  }
  return result;
}
function callRelations(root, symbols, aliases) {
  const result = [];
  for (const node of nodesOfTypes(root, ['call_expression'])) {
    const fn = fieldNode(node, 'function'); if (fn?.type !== 'selector_expression') continue;
    const text = nodeText(fn); const match = text.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/); const imported = match ? aliases.get(match[1]) : null;
    if (match && imported) result.push(relation(PROVIDER, 'CALLS', symbolForNode(node, symbols), match[2], new Map(), { moduleSpecifier: imported.specifier, targetQualifiedName: match[2], confidence: 0.97 }));
  }
  return result;
}
function enrichImports(imports) { return imports.map(({ bindings: _bindings, ...item }) => ({ ...item, provider: PROVIDER, confidence: 0.98 })); }
export { goResolver };
