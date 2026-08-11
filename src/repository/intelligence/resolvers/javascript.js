const PROVIDER = 'resolver-js-ts-v1';
const CAPABILITIES = Object.freeze(['import-bindings', 're-exports', 'inheritance', 'interfaces', 'constructor-types', 'typed-member-calls']);

const javascriptTypeResolver = Object.freeze({
  id: PROVIDER,
  capabilities: CAPABILITIES,
  enrich({ source, facts }) {
    const text = String(source || '');
    const imports = parseImports(text);
    const bindings = importBindingMap(imports);
    const relations = [
      ...classRelations(text, facts.symbols || [], bindings),
      ...typedUsageRelations(text, facts.symbols || [], bindings),
      ...memberCallRelations(text, facts.symbols || [], bindings)
    ];
    return { provider: PROVIDER, capabilities: CAPABILITIES, imports: imports.map(({ bindings: _bindings, ...item }) => ({ ...item, provider: PROVIDER, confidence: 0.96 })), relations: dedupe(relations) };
  }
});

function parseImports(source) {
  const items = [];
  const importPattern = /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"`]([^'"`]+)['"`]/g;
  for (const match of source.matchAll(importPattern)) items.push({ specifier: match[2], kind: 'import', bindings: parseClause(match[1]) });
  const requirePattern = /(?:const|let|var)\s+([^=;]+?)\s*=\s*require\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  for (const match of source.matchAll(requirePattern)) items.push({ specifier: match[2], kind: 'require', bindings: parseRequireBinding(match[1]) });
  const reExportPattern = /\bexport\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s+from\s+['"`]([^'"`]+)['"`]/g;
  for (const match of source.matchAll(reExportPattern)) items.push({ specifier: match[1], kind: 're-export', bindings: [] });
  return items;
}

function parseClause(value) {
  const clause = String(value || '').trim();
  const bindings = [];
  const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespace) bindings.push({ local: namespace[1], imported: '*', kind: 'namespace' });
  const named = clause.match(/\{([\s\S]*?)\}/);
  if (named) {
    for (const raw of named[1].split(',')) {
      const clean = raw.trim().replace(/^type\s+/, '');
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

function parseRequireBinding(value) {
  const text = String(value || '').trim();
  if (text.startsWith('{')) {
    return text.replace(/[{}]/g, '').split(',').map(part => {
      const [left, right] = part.trim().split(/\s*:\s*/);
      return { local: identifier(right || left), imported: identifier(left), kind: 'named' };
    }).filter(item => item.local && item.imported);
  }
  const local = identifier(text);
  return local ? [{ local, imported: '*', kind: 'namespace' }] : [];
}

function importBindingMap(imports) {
  const map = new Map();
  for (const item of imports) for (const binding of item.bindings || []) map.set(binding.local, { ...binding, specifier: item.specifier });
  return map;
}

function classRelations(source, symbols, bindings) {
  const relations = [];
  const pattern = /\b(class|interface)\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([^{]+?))?(?:\s+implements\s+([^{]+?))?\s*\{/g;
  for (const match of source.matchAll(pattern)) {
    const kind = match[1];
    const sourceSymbol = symbols.find(item => item.name === match[2] && (item.kind === kind || (kind === 'class' && item.kind === 'class')));
    if (!sourceSymbol) continue;
    for (const target of typeList(match[3])) relations.push(typeRelation('INHERITS', sourceSymbol.qualifiedName, target, bindings, 0.96));
    for (const target of typeList(match[4])) relations.push(typeRelation('IMPLEMENTS', sourceSymbol.qualifiedName, target, bindings, 0.96));
  }
  return relations;
}

function typedUsageRelations(source, symbols, bindings) {
  const relations = [];
  const pattern = /\b(?:const|let|var|public|private|protected|readonly)?\s*([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?))?\s*=\s*new\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/g;
  for (const match of source.matchAll(pattern)) {
    const target = match[2] || match[3];
    const owner = nearestSymbolByOffset(source, symbols, match.index || 0);
    relations.push(typeRelation('USES_TYPE', owner?.qualifiedName || null, target, bindings, 0.94, match[1]));
  }
  return relations;
}

function memberCallRelations(source, symbols, bindings) {
  const relations = [];
  const typed = new Map();
  const declarationPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?))?\s*=\s*new\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/g;
  for (const match of source.matchAll(declarationPattern)) typed.set(match[1], match[2] || match[3]);
  const callPattern = /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of source.matchAll(callPattern)) {
    const receiver = match[1];
    const method = match[2];
    const owner = nearestSymbolByOffset(source, symbols, match.index || 0);
    let typeName = typed.get(receiver) || null;
    let moduleSpecifier = null;
    const imported = bindings.get(receiver);
    if (!typeName && imported) {
      typeName = imported.imported === 'default' || imported.imported === '*' ? receiver : imported.imported;
      moduleSpecifier = imported.specifier;
    }
    if (!typeName) continue;
    const target = resolveType(typeName, bindings);
    relations.push({ type: 'CALLS', sourceQualifiedName: owner?.qualifiedName || null, sourceName: method, targetName: method, targetQualifiedName: `${target.name}.${method}`, moduleSpecifier: moduleSpecifier || target.moduleSpecifier, provider: PROVIDER, confidence: 0.95 });
  }
  return relations;
}

function typeRelation(type, sourceQualifiedName, rawTarget, bindings, confidence, sourceName = null) {
  const target = resolveType(rawTarget, bindings);
  return { type, sourceQualifiedName, sourceName, targetName: target.name, targetQualifiedName: target.name, moduleSpecifier: target.moduleSpecifier, provider: PROVIDER, confidence };
}

function resolveType(raw, bindings) {
  const name = identifier(String(raw || '').split('<', 1)[0].split('[', 1)[0]);
  const imported = bindings.get(name);
  if (!imported) return { name, moduleSpecifier: null };
  return { name: imported.imported === 'default' || imported.imported === '*' ? name : imported.imported, moduleSpecifier: imported.specifier };
}

function nearestSymbolByOffset(source, symbols, offset) {
  const line = source.slice(0, offset).split(/\r\n|\n|\r/).length;
  return symbols.filter(item => item.startLine <= line && item.endLine >= line).sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0] || null;
}

function typeList(value) {
  return String(value || '').split(',').map(identifier).filter(Boolean);
}

function identifier(value) {
  const match = String(value || '').trim().match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?/);
  return match?.[0] || '';
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = [item.type, item.sourceQualifiedName || '', item.sourceName || '', item.targetQualifiedName || '', item.targetName || '', item.moduleSpecifier || ''].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export { javascriptTypeResolver };
