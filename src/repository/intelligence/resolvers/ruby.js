import { dedupeRelations, fieldNode, importBindingMap, nodeText, nodesOfTypes, relation, simpleName, stripQuotes, symbolForNode } from './common.js';
import { frameworkRelations } from './frameworks.js';

const PROVIDER = 'resolver-ruby-v2';
const CAPABILITIES = Object.freeze(['ast-require-bindings', 'ast-inheritance', 'ast-mixins', 'ast-constructor-types', 'ast-module-calls', 'framework-http']);
const rubyResolver = Object.freeze({ id: PROVIDER, capabilities: CAPABILITIES, enrich({ root, facts, language }) {
  const imports = parseImports(root); const bindings = importBindingMap(imports); const symbols = facts.symbols || [];
  return { provider: PROVIDER, capabilities: CAPABILITIES, imports: enrichImports(imports), relations: dedupeRelations([
    ...inheritanceRelations(root, symbols, bindings), ...mixinRelations(root, symbols, bindings), ...callRelations(root, symbols, bindings),
    ...frameworkRelations(language, { root, symbols, provider: PROVIDER })
  ]) };
}});
function parseImports(root) {
  const result = [];
  for (const node of nodesOfTypes(root, ['call'])) {
    const method = nodeText(fieldNode(node, 'method')); if (!['require', 'require_relative'].includes(method)) continue;
    const text = nodeText(node); const match = text.match(/^(require_relative|require)\s*(?:\(|\s)\s*['"]([^'"]+)['"]/); if (!match) continue;
    const specifier = `${match[1] === 'require_relative' && !match[2].startsWith('.') ? './' : ''}${match[2]}`; const local = constantName(match[2]);
    result.push({ specifier, kind: match[1], bindings: local ? [{ local, imported: '*', kind: 'namespace' }] : [] });
  }
  return result;
}
function inheritanceRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['class'])) {
    const name = simpleName(nodeText(fieldNode(node, 'name'))); const owner = symbols.find(item => item.name === name)?.qualifiedName || name; const superclass = fieldNode(node, 'superclass');
    const target = nodeText(superclass).replace(/^<\s*/, '').trim(); if (target) result.push(relation(PROVIDER, 'INHERITS', owner, target, bindings, { confidence: 0.98 }));
  }
  return result;
}
function mixinRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['call'])) {
    const method = nodeText(fieldNode(node, 'method')); if (!['include', 'extend', 'prepend'].includes(method)) continue; const match = nodeText(node).match(/^(?:include|extend|prepend)\s+([A-Z][A-Za-z0-9_:]*)/);
    if (match) result.push(relation(PROVIDER, 'IMPLEMENTS', symbolForNode(node, symbols), match[1], bindings, { confidence: 0.95 }));
  }
  return result;
}
function callRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['call'])) {
    const receiver = nodeText(fieldNode(node, 'receiver')); const method = nodeText(fieldNode(node, 'method'));
    if (method === 'new' && /^[A-Z]/.test(simpleName(receiver))) result.push(relation(PROVIDER, 'USES_TYPE', symbolForNode(node, symbols), receiver, bindings, { confidence: 0.97 }));
    const imported = bindings.get(simpleName(receiver)); if (receiver && method && imported && method !== 'new') result.push(relation(PROVIDER, 'CALLS', symbolForNode(node, symbols), method, new Map(), { moduleSpecifier: imported.specifier, targetQualifiedName: method, confidence: 0.95 }));
  }
  return result;
}
function constantName(value) { const leaf = stripQuotes(value).replaceAll('\\', '/').split('/').at(-1)?.replace(/\.[^.]+$/, '') || ''; return leaf.split(/[_-]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(''); }
function enrichImports(imports) { return imports.map(({ bindings: _bindings, ...item }) => ({ ...item, provider: PROVIDER, confidence: 0.96 })); }
export { rubyResolver };
