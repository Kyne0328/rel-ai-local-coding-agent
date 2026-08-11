import { endpointRelation, followingSymbolForNode, httpKey, nodeText, nodesOfTypes, symbolForNode } from './common.js';

const HTTP_METHODS = 'get|post|put|patch|delete|head|options';

function frameworkRelations(language, { root, symbols = [], provider }) {
  switch (language) {
    case 'python': return pythonFramework(root, symbols, provider);
    case 'java': return annotationFramework(root, symbols, provider, ['annotation', 'marker_annotation']);
    case 'kotlin': return annotationFramework(root, symbols, provider, ['annotation', 'annotation_entry']);
    case 'csharp': return csharpFramework(root, symbols, provider);
    case 'go': return goFramework(root, symbols, provider);
    case 'rust': return rustFramework(root, symbols, provider);
    case 'php': return phpFramework(root, symbols, provider);
    case 'ruby': return rubyFramework(root, symbols, provider);
    default: return [];
  }
}

function pythonFramework(root, symbols, provider) {
  const result = [];
  for (const node of nodesOfTypes(root, ['decorator'])) {
    const match = nodeText(node).match(new RegExp(`^@(?:app|router|api)\\.(${HTTP_METHODS})\\s*\\(\\s*['"]([^'"]+)`, 'i'));
    if (!match) continue;
    result.push(endpointRelation(provider, 'HANDLES', followingSymbolForNode(node, symbols, ['function', 'method']), httpKey(match[1], match[2]), 0.97));
  }
  for (const node of nodesOfTypes(root, ['call'])) {
    const match = nodeText(node).match(new RegExp(`^(?:requests|httpx|client)\\.(${HTTP_METHODS})\\s*\\(\\s*['"]([^'"]+)`, 'i'));
    if (match) result.push(endpointRelation(provider, 'HTTP_CALLS', symbolForNode(node, symbols), httpKey(match[1], match[2]), 0.95));
  }
  return result;
}

function annotationFramework(root, symbols, provider, nodeTypes) {
  const result = [];
  for (const node of nodesOfTypes(root, nodeTypes)) {
    const match = nodeText(node).match(/^@(Get|Post|Put|Patch|Delete|Head|Options)Mapping\s*(?:\(\s*(?:value\s*=\s*|path\s*=\s*)?['"]([^'"]+)['"])?/i);
    if (!match || !match[2]) continue;
    result.push(endpointRelation(provider, 'HANDLES', followingSymbolForNode(node, symbols, ['method', 'function']), httpKey(match[1], match[2]), 0.97));
  }
  return result;
}

function csharpFramework(root, symbols, provider) {
  const result = [];
  for (const node of nodesOfTypes(root, ['attribute', 'attribute_list'])) {
    const match = nodeText(node).match(new RegExp(`Http(${HTTP_METHODS})\\s*(?:\\(\\s*['"]([^'"]+)['"])?`, 'i'));
    if (match?.[2]) result.push(endpointRelation(provider, 'HANDLES', followingSymbolForNode(node, symbols, ['method']), httpKey(match[1], match[2]), 0.97));
  }
  for (const node of nodesOfTypes(root, ['invocation_expression'])) {
    const match = nodeText(node).match(new RegExp(`\\bapp\\.Map(${HTTP_METHODS})\\s*\\(\\s*['"]([^'"]+)`, 'i'));
    if (match) result.push(endpointRelation(provider, 'HANDLES', symbolForNode(node, symbols), httpKey(match[1], match[2]), 0.96));
  }
  return result;
}

function goFramework(root, symbols, provider) {
  const result = [];
  for (const node of nodesOfTypes(root, ['call_expression'])) {
    const text = nodeText(node);
    const route = text.match(new RegExp(`^(?:app|router|server|api|route|engine|group|r|e)\\.(${HTTP_METHODS})\\s*\\(\\s*['"]([^'"]+)`, 'i'));
    if (route && /^\//.test(route[2])) result.push(endpointRelation(provider, 'HANDLES', symbolForNode(node, symbols), httpKey(route[1], route[2]), 0.95));
    const outbound = text.match(new RegExp(`^(?:http|client)\\.(${HTTP_METHODS})\\s*\\(\\s*['"]([^'"]+)`, 'i'));
    if (outbound) result.push(endpointRelation(provider, 'HTTP_CALLS', symbolForNode(node, symbols), httpKey(outbound[1], outbound[2]), 0.95));
  }
  return result;
}

function rustFramework(root, symbols, provider) {
  const result = [];
  for (const node of nodesOfTypes(root, ['call_expression'])) {
    const match = nodeText(node).match(new RegExp(`\\.route\\s*\\(\\s*['"]([^'"]+)['"]\\s*,\\s*(${HTTP_METHODS})\\s*\\(`, 'i'));
    if (match) result.push(endpointRelation(provider, 'HANDLES', symbolForNode(node, symbols), httpKey(match[2], match[1]), 0.93));
  }
  return result;
}

function phpFramework(root, symbols, provider) {
  const result = [];
  for (const node of nodesOfTypes(root, ['scoped_call_expression', 'member_call_expression', 'function_call_expression'])) {
    const match = nodeText(node).match(new RegExp(`^Route::(${HTTP_METHODS})\\s*\\(\\s*['"]([^'"]+)`, 'i'));
    if (match) result.push(endpointRelation(provider, 'HANDLES', symbolForNode(node, symbols), httpKey(match[1], match[2]), 0.96));
  }
  return result;
}

function rubyFramework(root, symbols, provider) {
  const result = [];
  for (const node of nodesOfTypes(root, ['call'])) {
    const match = nodeText(node).match(new RegExp(`^(${HTTP_METHODS})\\s*(?:\\(|\\s)\\s*['"]([^'"]+)`, 'i'));
    if (match && /^\//.test(match[2])) result.push(endpointRelation(provider, 'HANDLES', symbolForNode(node, symbols), httpKey(match[1], match[2]), 0.94));
  }
  return result;
}

export { frameworkRelations };
