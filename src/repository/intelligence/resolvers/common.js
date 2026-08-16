function namedChildren(node) {
  try { return Array.from(node?.namedChildren || []); } catch { return []; }
}

function nodesOfTypes(root, types) {
  const wanted = types instanceof Set ? types : new Set(types || []);
  const result = [];
  const stack = root ? [root] : [];
  while (stack.length) {
    const node = stack.pop();
    if (wanted.has(node.type)) result.push(node);
    const children = namedChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return result;
}

function descendantsOfTypes(root, types) {
  const wanted = types instanceof Set ? types : new Set(types || []);
  const result = [];
  const stack = [...namedChildren(root)].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (wanted.has(node.type)) result.push(node);
    const children = namedChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return result;
}

function fieldNode(node, ...names) {
  for (const name of names) {
    try {
      const child = node?.childForFieldName?.(name);
      if (child) return child;
    } catch {}
  }
  return null;
}

function nodeText(node) { return String(node?.text || '').trim(); }

function simpleName(value) {
  const raw = String(value || '').trim();
  const cutoffs = [raw.indexOf('<'), raw.indexOf('[')].filter(index => index >= 0);
  const text = cutoffs.length ? raw.slice(0, Math.min(...cutoffs)) : raw;
  const parts = text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
  return parts.at(-1) || '';
}

function symbolForNode(node, symbols) {
  if (!node) return null;
  const row = Number(node.startPosition?.row || 0) + 1;
  return (symbols || []).filter(item => item.startLine <= row && item.endLine >= row)
    .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0] || null;
}

function followingSymbolForNode(node, symbols, kinds = []) {
  if (!node) return null;
  const row = Number(node.startPosition?.row || 0) + 1;
  const allowed = new Set(kinds || []);
  return (symbols || []).filter(item => item.startLine >= row && (!allowed.size || allowed.has(item.kind)))
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine)[0] || null;
}

function importBindingMap(imports) {
  const result = new Map();
  for (const item of imports || []) for (const binding of item.bindings || []) result.set(binding.local, { ...binding, specifier: item.specifier });
  return result;
}

function boundTarget(raw, bindings) {
  const rawText = String(raw || '').trim();
  const qualified = rawText.match(/^([A-Za-z_$][A-Za-z0-9_$]*)[.:]{1,2}([A-Za-z_$][A-Za-z0-9_$]*)/);
  if (qualified) {
    const namespace = bindings.get(qualified[1]);
    if (namespace?.imported === '*' || namespace?.kind === 'namespace') {
      return { name: qualified[2], qualifiedName: qualified[2], moduleSpecifier: namespace.specifier || null };
    }
  }
  const local = simpleName(rawText);
  const imported = bindings.get(local);
  if (!imported) return { name: local, qualifiedName: local, moduleSpecifier: null };
  const name = imported.imported && imported.imported !== '*' && imported.imported !== 'default' ? imported.imported : local;
  return { name: simpleName(name), qualifiedName: String(name), moduleSpecifier: imported.specifier || null };
}

function relation(provider, type, owner, rawTarget, bindings, options = {}) {
  const target = boundTarget(rawTarget, bindings || new Map());
  if (!target.name) return null;
  return {
    type,
    sourceQualifiedName: typeof owner === 'string' ? owner : owner?.qualifiedName || null,
    sourceName: options.sourceName || null,
    targetName: target.name,
    targetQualifiedName: options.targetQualifiedName || target.qualifiedName || target.name,
    moduleSpecifier: options.moduleSpecifier ?? target.moduleSpecifier,
    provider,
    confidence: Number(options.confidence || 0.94)
  };
}

function endpointRelation(provider, type, owner, targetName, confidence = 0.94) {
  if (!targetName) return null;
  return { type, sourceQualifiedName: owner?.qualifiedName || null, sourceName: owner?.name || null, targetName, targetQualifiedName: null, moduleSpecifier: null, provider, confidence };
}

function httpKey(method, value) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('${') || raw.includes('#{')) return '';
  const upper = String(method || 'GET').toUpperCase();
  if (/^https?:\/\//i.test(raw)) {
    try { const parsed = new URL(raw); return `${upper} ${parsed.origin}${normalizeHttpPath(parsed.pathname)}`; } catch { return ''; }
  }
  const pathOnly = raw.split(/[?#]/, 1)[0];
  if (!pathOnly.startsWith('/')) return '';
  return `${upper} ${normalizeHttpPath(pathOnly)}`;
}

function normalizeHttpPath(value) {
  const normalized = String(value || '/').replace(/\/{2,}/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}

function dedupeRelations(items) {
  const seen = new Set();
  return (items || []).filter(Boolean).filter(item => {
    const key = [item.type, item.sourceQualifiedName || '', item.sourceName || '', item.targetQualifiedName || '', item.targetName || '', item.moduleSpecifier || ''].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripQuotes(value) { return String(value || '').trim().replace(/^['"`]|['"`]$/g, ''); }

export {
  dedupeRelations, descendantsOfTypes, endpointRelation, fieldNode, followingSymbolForNode, httpKey,
  importBindingMap, namedChildren, nodeText, nodesOfTypes, relation, simpleName,
  stripQuotes, symbolForNode
};
