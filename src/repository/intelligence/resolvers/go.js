import { dedupeRelations, nearestSymbolByOffset, relation, simpleName } from './common.js';

const PROVIDER = 'resolver-go-v1';
const CAPABILITIES = Object.freeze(['import-bindings', 'package-calls', 'package-types']);
const goResolver = Object.freeze({ id: PROVIDER, capabilities: CAPABILITIES, enrich({ source, facts }) {
  const text=String(source||''); const imports=parseImports(text); const aliases=new Map(); for(const item of imports) for(const b of item.bindings||[]) aliases.set(b.local,{...b,specifier:item.specifier}); const symbols=facts.symbols||[];
  return { provider:PROVIDER, capabilities:CAPABILITIES, imports:imports.map(({bindings:_bindings,...item})=>({...item,provider:PROVIDER,confidence:0.96})), relations:dedupeRelations([...callRelations(text,symbols,aliases),...typeRelations(text,symbols,aliases)]) };
}});
function parseImports(source){const result=[];const add=(alias,specifier)=>{const local=alias&&alias!=='.'&&alias!=='_'?alias:simpleName(specifier.split('/').at(-1));result.push({specifier,kind:'import',bindings:local?[{local,imported:'*',kind:'namespace'}]:[]});};for(const block of source.matchAll(/\bimport\s*\(([\s\S]*?)\)/g))for(const m of block[1].matchAll(/(?:^|\n)\s*(?:([A-Za-z_]\w*|[._])\s+)?"([^"]+)"/g))add(m[1],m[2]);for(const m of source.matchAll(/^\s*import\s+(?:([A-Za-z_]\w*|[._])\s+)?"([^"]+)"/gm))add(m[1],m[2]);return result;}
function callRelations(source,symbols,aliases){const result=[];for(const m of source.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/g)){const item=aliases.get(m[1]);if(item)result.push(relation(PROVIDER,'CALLS',nearestSymbolByOffset(source,symbols,m.index||0),m[2],new Map(),{moduleSpecifier:item.specifier,targetQualifiedName:m[2],confidence:0.95}));}return result;}
function typeRelations(source,symbols,aliases){const result=[];for(const m of source.matchAll(/\b(?:var\s+[A-Za-z_]\w*\s+|[A-Za-z_]\w*\s*:=\s*)?([A-Za-z_]\w*)\.([A-Z][A-Za-z0-9_]*)\s*(?:\{|\b)/g)){const item=aliases.get(m[1]);if(item)result.push(relation(PROVIDER,'USES_TYPE',nearestSymbolByOffset(source,symbols,m.index||0),m[2],new Map(),{moduleSpecifier:item.specifier,targetQualifiedName:m[2],confidence:0.93}));}return result;}
export { goResolver };
