import {
  dedupeRelations, endpointRelation, fieldNode, httpKey, importBindingMap, namedChildren, nodeText,
  nodesOfTypes, relation, simpleName, stripQuotes, symbolForNode
} from './common.js';

const PROVIDER = 'resolver-js-ts-v2';
const CAPABILITIES = Object.freeze([
  'ast-import-bindings', 'ast-re-exports', 'ast-inheritance', 'ast-interfaces', 'ast-constructor-types',
  'ast-typed-member-calls', 'ast-http-routes', 'ast-http-calls', 'ast-events'
]);
const CALL_TYPES = new Set(['call_expression', 'new_expression']);
const STRING_TYPES = new Set(['string', 'string_fragment', 'template_string']);

const javascriptTypeResolver = Object.freeze({
  id: PROVIDER,
  capabilities: CAPABILITIES,
  enrich({ root, facts }) {
    const imports = parseImports(root);
    const bindings = importBindingMap(imports);
    const symbols = facts.symbols || [];
    const typed = typedBindings(root);
    return {
      provider: PROVIDER,
      capabilities: CAPABILITIES,
      imports: imports.map(({ bindings: _bindings, ...item }) => ({ ...item, provider: PROVIDER, confidence: 0.98 })),
      relations: dedupeRelations([
        ...classRelations(root, symbols, bindings),
        ...typedUsageRelations(root, symbols, bindings, typed),
        ...memberCallRelations(root, symbols, bindings, typed),
        ...boundaryRelations(root, symbols, bindings)
      ])
    };
  }
});

function parseImports(root) {
  const result = [];
  for (const node of nodesOfTypes(root, ['import_statement'])) {
    const source = importSource(node);
    if (!source) continue;
    result.push({ specifier: source, kind: 'import', bindings: parseImportClause(nodeText(node)) });
  }
  for (const node of nodesOfTypes(root, ['export_statement'])) {
    const text = nodeText(node);
    if (!/\bfrom\b/.test(text)) continue;
    const source = importSource(node);
    if (source) result.push({ specifier: source, kind: 're-export', bindings: [] });
  }
  for (const node of nodesOfTypes(root, ['variable_declarator'])) {
    const name = fieldNode(node, 'name');
    const value = fieldNode(node, 'value');
    if (!name || !value || !CALL_TYPES.has(value.type)) continue;
    const call = callParts(value);
    if (call.functionText !== 'require') continue;
    const specifier = stringArgument(call.arguments[0]);
    if (!specifier) continue;
    result.push({ specifier, kind: 'require', bindings: parseRequireBinding(nodeText(name)) });
  }
  return dedupeImports(result);
}

function importSource(node) {
  const field = fieldNode(node, 'source');
  if (field) return staticString(field);
  const strings = namedChildren(node).filter(child => isStringNode(child));
  return strings.length ? staticString(strings.at(-1)) : '';
}

function parseImportClause(text) {
  const statement = String(text || '').replace(/^\s*import\s+(?:type\s+)?/, '');
  const fromIndex = statement.lastIndexOf(' from ');
  if (fromIndex < 0) return [];
  const clause = statement.slice(0, fromIndex).trim();
  const bindings = [];
  const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespace) bindings.push({ local: namespace[1], imported: '*', kind: 'namespace' });
  const named = clause.match(/\{([\s\S]*?)\}/);
  if (named) {
    for (const part of named[1].split(',')) {
      const clean = part.trim().replace(/^type\s+/, '');
      if (!clean) continue;
      const [left, right] = clean.split(/\s+as\s+/);
      const imported = identifier(left);
      const local = identifier(right || left);
      if (imported && local) bindings.push({ local, imported, kind: 'named' });
    }
  }
  const defaultPart = clause.split(/[,{*]/, 1)[0].trim().replace(/^type\s+/, '');
  if (/^[A-Za-z_$][\w$]*$/.test(defaultPart)) bindings.push({ local: defaultPart, imported: 'default', kind: 'default' });
  return bindings;
}

function parseRequireBinding(text) {
  const value = String(text || '').trim();
  if (value.startsWith('{')) {
    return value.replace(/[{}]/g, '').split(',').map(part => {
      const [left, right] = part.trim().split(/\s*:\s*/);
      return { local: identifier(right || left), imported: identifier(left), kind: 'named' };
    }).filter(item => item.local && item.imported);
  }
  const local = identifier(value);
  return local ? [{ local, imported: '*', kind: 'namespace' }] : [];
}

function classRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['class_declaration', 'class', 'interface_declaration'])) {
    const owner = symbolForNode(node, symbols);
    if (!owner) continue;
    const text = nodeText(node).split('{', 1)[0];
    const inherited = text.match(/\bextends\s+([^{]+?)(?=\s+implements\b|$)/)?.[1] || '';
    const implemented = text.match(/\bimplements\s+([^{]+)$/)?.[1] || '';
    for (const target of typeList(inherited)) result.push(relation(PROVIDER, 'INHERITS', owner, target, bindings, { confidence: 0.98 }));
    for (const target of typeList(implemented)) result.push(relation(PROVIDER, 'IMPLEMENTS', owner, target, bindings, { confidence: 0.98 }));
  }
  return result;
}

function typedBindings(root) {
  const result = new Map();
  for (const node of nodesOfTypes(root, ['variable_declarator'])) {
    const text = nodeText(node);
    const match = text.match(/^\s*([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?))?\s*=\s*new\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/);
    if (match) result.set(match[1], match[2] || match[3]);
  }
  return result;
}

function typedUsageRelations(root, symbols, bindings, typed) {
  const result = [];
  for (const node of nodesOfTypes(root, ['variable_declarator'])) {
    const nameNode = fieldNode(node, 'name');
    const name = identifier(nodeText(nameNode));
    const target = typed.get(name);
    if (!name || !target) continue;
    result.push(relation(PROVIDER, 'USES_TYPE', symbolForNode(node, symbols), target, bindings, { sourceName: name, confidence: 0.97 }));
  }
  return result;
}

function memberCallRelations(root, symbols, bindings, typed) {
  const result = [];
  for (const node of nodesOfTypes(root, ['call_expression'])) {
    const call = callParts(node);
    const member = memberName(call.functionText);
    if (!member) continue;
    const [receiver, method] = member;
    let typeName = typed.get(receiver) || '';
    let moduleSpecifier = null;
    const imported = bindings.get(receiver);
    if (!typeName && imported) {
      typeName = imported.imported === 'default' || imported.imported === '*' ? receiver : imported.imported;
      moduleSpecifier = imported.specifier;
    }
    if (!typeName || isBoundaryCall(receiver, method, bindings)) continue;
    const target = relation(PROVIDER, 'CALLS', symbolForNode(node, symbols), `${typeName}.${method}`, bindings, {
      sourceName: method,
      targetQualifiedName: `${simpleName(typeName)}.${method}`,
      moduleSpecifier,
      confidence: 0.97
    });
    if (target) result.push(target);
  }
  return result;
}

function boundaryRelations(root, symbols, bindings) {
  const result = [];
  for (const node of nodesOfTypes(root, ['call_expression'])) {
    const call = callParts(node);
    const member = memberName(call.functionText);
    const owner = symbolForNode(node, symbols);

    if (member) {
      const [receiver, method] = member;
      if (isHttpMethod(method) && isRouteReceiver(receiver)) {
        const route = httpKey(method, stringArgument(call.arguments[0]));
        if (route) {
          const handlerName = argumentIdentifier(call.arguments[1]);
          const handler = handlerName ? symbols.find(item => item.name === handlerName && ['function', 'method'].includes(item.kind)) : null;
          result.push(endpointRelation(PROVIDER, 'HANDLES', handler || owner, route, handler ? 0.99 : 0.94));
        }
      } else if (isHttpMethod(method) && isHttpClient(receiver, bindings)) {
        const route = httpKey(method, stringArgument(call.arguments[0]));
        if (route) result.push(endpointRelation(PROVIDER, 'HTTP_CALLS', owner, route, 0.98));
      }

      if (['on', 'once', 'addEventListener'].includes(method)) {
        const event = stringArgument(call.arguments[0]);
        if (event) {
          const handlerName = argumentIdentifier(call.arguments[1]);
          const handler = handlerName ? symbols.find(item => item.name === handlerName && ['function', 'method'].includes(item.kind)) : null;
          result.push(endpointRelation(PROVIDER, 'LISTENS_ON', handler || owner, `event:${event}`, handler ? 0.99 : 0.94));
        }
      } else if (['emit', 'publish', 'dispatch'].includes(method)) {
        const event = stringArgument(call.arguments[0]);
        if (event) result.push(endpointRelation(PROVIDER, 'EMITS', owner, `event:${event}`, 0.98));
      }
    } else if (call.functionText === 'fetch') {
      const target = stringArgument(call.arguments[0]);
      const optionsText = nodeText(call.arguments[1]);
      const method = optionsText.match(/\bmethod\s*:\s*['"`](get|post|put|patch|delete|head|options)['"`]/i)?.[1] || 'GET';
      const route = httpKey(method, target);
      if (route) result.push(endpointRelation(PROVIDER, 'HTTP_CALLS', owner, route, 0.99));
    }
  }
  return result;
}

function callParts(node) {
  const fn = fieldNode(node, 'function', 'constructor') || namedChildren(node)[0] || null;
  const argsNode = fieldNode(node, 'arguments') || namedChildren(node).find(child => child.type === 'arguments') || null;
  return { functionText: nodeText(fn), arguments: namedChildren(argsNode) };
}

function staticString(node) {
  if (!node || !isStringNode(node)) return '';
  const text = nodeText(node);
  if (node.type === 'template_string' && text.includes('${')) return '';
  return stripQuotes(text);
}
function stringArgument(node) { return staticString(node); }
function isStringNode(node) { return Boolean(node && (STRING_TYPES.has(node.type) || /string/.test(node.type))); }
function argumentIdentifier(node) { const value = nodeText(node); return /^[A-Za-z_$][\w$]*$/.test(value) ? value : ''; }
function memberName(value) { const match = String(value || '').match(/^([A-Za-z_$][\w$]*)\??\.([A-Za-z_$][\w$]*)$/); return match ? [match[1], match[2]] : null; }
function isHttpMethod(value) { return /^(?:get|post|put|patch|delete|head|options)$/i.test(String(value || '')); }
function isBoundaryCall(receiver, method, bindings) {
  if (['on', 'once', 'addEventListener', 'emit', 'publish', 'dispatch'].includes(String(method || ''))) return true;
  return isHttpMethod(method) && (isRouteReceiver(receiver) || isHttpClient(receiver, bindings));
}
function isRouteReceiver(value) { return /^(?:app|router|server|fastify|api|route)$/i.test(String(value || '')); }
function isHttpClient(value, bindings) {
  const name = String(value || '');
  if (/^(?:axios|ky|got|request|httpClient|apiClient)$/i.test(name)) return true;
  const imported = bindings.get(name);
  return Boolean(imported && /^(?:axios|ky|got|node-fetch|undici|superagent)(?:\/|$)/i.test(imported.specifier));
}
function typeList(value) { return String(value || '').split(',').map(item => item.trim().split(/\s+/)[0]).map(simpleName).filter(Boolean); }
function identifier(value) { return String(value || '').trim().match(/[A-Za-z_$][\w$]*/)?.[0] || ''; }
function dedupeImports(items) {
  const seen = new Set();
  return items.filter(item => { const key = `${item.kind}:${item.specifier}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

export { javascriptTypeResolver };
