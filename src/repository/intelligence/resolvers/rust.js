import { dedupeRelations, fieldNode, importBindingMap, nodeText, nodesOfTypes, relation, simpleName, symbolForNode } from './common.js';
import { frameworkRelations } from './frameworks.js';

const PROVIDER = 'resolver-rust-v2';
const CAPABILITIES = Object.freeze(['ast-use-bindings', 'ast-trait-implementations', 'ast-constructor-types', 'ast-imported-calls', 'framework-http']);
const rustResolver = Object.freeze({ id: PROVIDER, capabilities: CAPABILITIES, enrich({ root, facts, language }) {
  const imports = parseImports(root); const bindings = importBindingMap(imports); const symbols = facts.symbols || [];
  return { provider: PROVIDER, capabilities: CAPABILITIES, imports: enrichImports(imports), relations: dedupeRelations([
    ...implRelations(root, bindings), ...constructorRelations(root, symbols, bindings), ...callRelations(root, symbols, bindings),
    ...frameworkRelations(language, { root, symbols, provider: PROVIDER })
  ]) };
}});
function parseImports(root) {
  const result = [];
  for (const node of nodesOfTypes(root, ['use_declaration'])) {
    const raw = nodeText(fieldNode(node, 'argument') || node).replace(/^use\s+/, '').replace(/;$/, '').trim();
    if (!raw || /[{}*]/.test(raw)) continue;
    const aliasMatch = raw.match(/\s+as\s+([A-Za-z_]\w*)$/); const clean = raw.replace(/\s+as\s+.*$/, ''); const parts = clean.split('::').filter(Boolean);
    while (['crate', 'self', 'super'].includes(parts[0])) parts.shift(); if (!parts.length) continue;
    const imported = parts.pop(); const specifier = parts.join('/') || imported; const local = aliasMatch?.[1] || simpleName(imported);
    result.push({ specifier, kind: 'use', bindings: [{ local, imported: simpleName(imported), kind: 'named' }] });
  }
  return result;
}
function implRelations(root, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['impl_item'])) {
    const trait = fieldNode(node, 'trait'); const type = fieldNode(node, 'type'); if (trait && type) result.push(relation(PROVIDER, 'IMPLEMENTS', simpleName(nodeText(type)), nodeText(trait), bindings, { confidence: 0.99 }));
  }
  return result;
}
function constructorRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['call_expression'])) {
    const fn = fieldNode(node, 'function'); if (fn?.type !== 'scoped_identifier') continue;
    const text = nodeText(fn); const match = text.match(/^([A-Z][A-Za-z0-9_]*)::(?:new|default|from|with_[A-Za-z0-9_]+)$/); if (!match) continue;
    result.push(relation(PROVIDER, 'USES_TYPE', symbolForNode(node, symbols), match[1], bindings, { confidence: 0.96 }));
  }
  return result;
}
function callRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['call_expression'])) {
    const fn = fieldNode(node, 'function'); const text = nodeText(fn);
    if (fn?.type === 'identifier' && bindings.has(text)) result.push(relation(PROVIDER, 'CALLS', symbolForNode(node, symbols), text, bindings, { confidence: 0.97 }));
    if (fn?.type === 'scoped_identifier') {
      const match = text.match(/^([A-Z][A-Za-z0-9_]*)::([A-Za-z_]\w*)$/); const imported = match ? bindings.get(match[1]) : null;
      if (match && imported) result.push(relation(PROVIDER, 'CALLS', symbolForNode(node, symbols), match[2], new Map(), { moduleSpecifier: imported.specifier, targetQualifiedName: `${simpleName(imported.imported)}::${match[2]}`, confidence: 0.96 }));
    }
  }
  return result;
}
function enrichImports(imports) { return imports.map(({ bindings: _bindings, ...item }) => ({ ...item, provider: PROVIDER, confidence: 0.98 })); }
export { rustResolver };
