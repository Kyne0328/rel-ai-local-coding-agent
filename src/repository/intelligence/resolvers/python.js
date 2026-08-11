import { dedupeRelations, fieldNode, importBindingMap, namedChildren, nodeText, nodesOfTypes, relation, simpleName, symbolForNode } from './common.js';
import { frameworkRelations } from './frameworks.js';

const PROVIDER = 'resolver-python-v2';
const CAPABILITIES = Object.freeze(['ast-import-bindings', 'ast-inheritance', 'ast-constructor-types', 'ast-imported-calls', 'framework-http']);

const pythonResolver = Object.freeze({ id: PROVIDER, capabilities: CAPABILITIES, enrich({ root, facts, language }) {
  const imports = parseImports(root);
  const bindings = importBindingMap(imports);
  const symbols = facts.symbols || [];
  const relations = [
    ...inheritanceRelations(root, symbols, bindings),
    ...constructorRelations(root, symbols, bindings),
    ...callRelations(root, symbols, bindings),
    ...frameworkRelations(language, { root, symbols, provider: PROVIDER })
  ];
  return { provider: PROVIDER, capabilities: CAPABILITIES, imports: enrichImports(imports), relations: dedupeRelations(relations) };
}});

function parseImports(root) {
  const imports = [];
  for (const node of nodesOfTypes(root, ['import_from_statement'])) {
    const text = nodeText(node);
    const match = text.match(/^from\s+([.A-Za-z_]\w*(?:\.\w+)*)\s+import\s+([\s\S]+)$/);
    if (!match) continue;
    const specifier = pythonSpecifier(match[1]);
    const bindings = match[2].replace(/[()]/g, '').split(',').map(binding).filter(Boolean);
    imports.push({ specifier, kind: 'from-import', bindings });
  }
  for (const node of nodesOfTypes(root, ['import_statement'])) {
    const text = nodeText(node).replace(/^import\s+/, '');
    for (const raw of text.split(',')) {
      const parts = raw.trim().split(/\s+as\s+/);
      const imported = parts[0]?.trim();
      if (!imported) continue;
      imports.push({ specifier: pythonSpecifier(imported), kind: 'import', bindings: [{ local: simpleName(parts[1] || imported), imported: '*', kind: 'namespace' }] });
    }
  }
  return imports;
}

function inheritanceRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['class_definition'])) {
    const ownerName = simpleName(nodeText(fieldNode(node, 'name')));
    const owner = symbols.find(item => item.name === ownerName)?.qualifiedName || ownerName;
    const bases = fieldNode(node, 'superclasses');
    for (const base of namedChildren(bases)) {
      if (base.type === 'keyword_argument') continue;
      result.push(relation(PROVIDER, 'INHERITS', owner, nodeText(base), bindings, { confidence: 0.98 }));
    }
  }
  return result;
}

function constructorRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['assignment'])) {
    const right = fieldNode(node, 'right');
    if (right?.type !== 'call') continue;
    const target = nodeText(fieldNode(right, 'function'));
    if (!/^[A-Z]/.test(simpleName(target))) continue;
    result.push(relation(PROVIDER, 'USES_TYPE', symbolForNode(node, symbols), target, bindings, { sourceName: simpleName(nodeText(fieldNode(node, 'left'))), confidence: 0.96 }));
  }
  return result;
}

function callRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['call'])) {
    const fn = fieldNode(node, 'function');
    const text = nodeText(fn);
    const direct = simpleName(text);
    if (fn?.type === 'identifier' && bindings.has(direct)) result.push(relation(PROVIDER, 'CALLS', symbolForNode(node, symbols), direct, bindings, { confidence: 0.97 }));
    if (fn?.type === 'attribute') {
      const match = text.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
      const imported = match ? bindings.get(match[1]) : null;
      if (match && imported?.imported === '*') result.push(relation(PROVIDER, 'CALLS', symbolForNode(node, symbols), match[2], new Map(), { moduleSpecifier: imported.specifier, targetQualifiedName: match[2], confidence: 0.96 }));
    }
  }
  return result;
}

function binding(value) {
  const parts = String(value || '').trim().split(/\s+as\s+/);
  const imported = simpleName(parts[0]); const local = simpleName(parts[1] || parts[0]);
  return imported && local ? { local, imported, kind: 'named' } : null;
}
function pythonSpecifier(value) {
  const raw = String(value || '').trim(); const dots = raw.match(/^\.+/)?.[0].length || 0; const body = raw.slice(dots).replaceAll('.', '/');
  if (!dots) return body; return `${dots === 1 ? './' : '../'.repeat(dots - 1)}${body}`.replace(/\/$/, '');
}
function enrichImports(imports) { return imports.map(({ bindings: _bindings, ...item }) => ({ ...item, provider: PROVIDER, confidence: 0.97 })); }

export { pythonResolver };
