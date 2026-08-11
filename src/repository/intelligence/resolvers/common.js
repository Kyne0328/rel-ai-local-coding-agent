function nearestSymbolByOffset(source, symbols, offset) {
  const line = String(source || '').slice(0, Math.max(0, Number(offset || 0))).split(/\r\n|\n|\r/).length;
  return (symbols || []).filter(item => item.startLine <= line && item.endLine >= line)
    .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0] || null;
}

function importBindingMap(imports) {
  const result = new Map();
  for (const item of imports || []) {
    for (const binding of item.bindings || []) result.set(binding.local, { ...binding, specifier: item.specifier });
  }
  return result;
}

function simpleName(value) {
  const text = String(value || '').replace(/[<\[].*$/, '').trim();
  const parts = text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
  return parts.at(-1) || '';
}

function boundTarget(raw, bindings) {
  const local = simpleName(raw);
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

function dedupeRelations(items) {
  const seen = new Set();
  return (items || []).filter(Boolean).filter(item => {
    const key = [item.type, item.sourceQualifiedName || '', item.sourceName || '', item.targetQualifiedName || '', item.targetName || '', item.moduleSpecifier || ''].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitTypeList(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

export { boundTarget, dedupeRelations, importBindingMap, nearestSymbolByOffset, relation, simpleName, splitTypeList };
