import { dedupeRelations, importBindingMap, nearestSymbolByOffset, relation, simpleName } from './common.js';

const PROVIDER = 'resolver-ruby-v1';
const CAPABILITIES = Object.freeze(['require-bindings', 'inheritance', 'mixins', 'constructor-types', 'module-calls']);
const rubyResolver = Object.freeze({ id:PROVIDER, capabilities:CAPABILITIES, enrich({source,facts}) {
  const text=String(source||'');const imports=parseImports(text);const bindings=importBindingMap(imports);const symbols=facts.symbols||[];
  return {provider:PROVIDER,capabilities:CAPABILITIES,imports:imports.map(({bindings:_bindings,...item})=>({...item,provider:PROVIDER,confidence:0.94})),relations:dedupeRelations([...inheritanceRelations(text,symbols,bindings),...mixinRelations(text,symbols,bindings),...constructorRelations(text,symbols,bindings),...callRelations(text,symbols,bindings)])};
}});
function parseImports(source){const result=[];for(const m of source.matchAll(/^\s*(require_relative|require)\s*\(?\s*['"]([^'"]+)['"]/gm)){const relative=m[1]==='require_relative';const specifier=(relative&&!m[2].startsWith('.')?'./':'')+m[2];const local=constantName(m[2]);result.push({specifier,kind:m[1],bindings:local?[{local,imported:'*',kind:'namespace'}]:[]});}return result;}
function constantName(value){const leaf=String(value||'').replaceAll('\\','/').split('/').at(-1)?.replace(/\.[^.]+$/,'')||'';return leaf.split(/[_-]+/).filter(Boolean).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join('');}
function inheritanceRelations(source,symbols,bindings){const result=[];for(const m of source.matchAll(/\bclass\s+([A-Z][A-Za-z0-9_:]*)\s*<\s*([A-Z][A-Za-z0-9_:]*)/g)){const owner=symbols.find(item=>item.name===simpleName(m[1]))?.qualifiedName||simpleName(m[1]);result.push(relation(PROVIDER,'INHERITS',owner,m[2],bindings,{confidence:0.97}));}return result;}
function mixinRelations(source,symbols,bindings){const result=[];for(const m of source.matchAll(/^\s*(?:include|extend|prepend)\s+([A-Z][A-Za-z0-9_:]*)/gm))result.push(relation(PROVIDER,'IMPLEMENTS',nearestSymbolByOffset(source,symbols,m.index||0),m[1],bindings,{confidence:0.93}));return result;}
function constructorRelations(source,symbols,bindings){const result=[];for(const m of source.matchAll(/\b([A-Z][A-Za-z0-9_:]*)\.new\s*(?:\(|\b)/g))result.push(relation(PROVIDER,'USES_TYPE',nearestSymbolByOffset(source,symbols,m.index||0),m[1],bindings,{confidence:0.95}));return result;}
function callRelations(source,symbols,bindings){const result=[];for(const m of source.matchAll(/\b([A-Z][A-Za-z0-9_:]*)\.([a-z_][A-Za-z0-9_!?]*)\s*(?:\(|\b)/g)){const item=bindings.get(simpleName(m[1]));if(item)result.push(relation(PROVIDER,'CALLS',nearestSymbolByOffset(source,symbols,m.index||0),m[2],new Map(),{moduleSpecifier:item.specifier,targetQualifiedName:m[2],confidence:0.92}));}return result;}
export { rubyResolver };
