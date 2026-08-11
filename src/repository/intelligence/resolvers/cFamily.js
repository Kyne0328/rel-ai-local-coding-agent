import { dedupeRelations, nearestSymbolByOffset, relation, simpleName, splitTypeList } from './common.js';

const PROVIDER = 'resolver-c-family-v1';
const CAPABILITIES = Object.freeze(['includes', 'inheritance', 'constructor-types', 'scoped-calls']);
const cFamilyResolver = Object.freeze({ id: PROVIDER, capabilities: CAPABILITIES, enrich({ source, facts, language }) {
  const text=String(source||'');const imports=parseIncludes(text);const symbols=facts.symbols||[];const relations=[];
  if(language==='cpp')relations.push(...inheritanceRelations(text,symbols),...constructorRelations(text,symbols),...callRelations(text,symbols));
  return {provider:PROVIDER,capabilities:CAPABILITIES,imports:imports.map(item=>({...item,provider:PROVIDER,confidence:0.96})),relations:dedupeRelations(relations)};
}});
function parseIncludes(source){const result=[];for(const m of source.matchAll(/^\s*#\s*include\s*([<"])([^>"]+)[>"]/gm)){const local=m[1]==='"';result.push({specifier:(local?'./':'')+m[2],kind:'include',bindings:[]});}return result;}
function inheritanceRelations(source,symbols){const result=[];for(const m of source.matchAll(/\bclass\s+([A-Za-z_]\w*)\s*:\s*([^\{]+)\{/g)){const owner=symbols.find(item=>item.name===m[1])?.qualifiedName||m[1];for(const raw of splitTypeList(m[2])){const target=raw.replace(/\b(?:public|protected|private|virtual)\b/g,'').trim();result.push(relation(PROVIDER,'INHERITS',owner,target,new Map(),{confidence:0.96}));}}return result;}
function constructorRelations(source,symbols){const result=[];for(const m of source.matchAll(/\bnew\s+([A-Z][A-Za-z0-9_]*)\b/g))result.push(relation(PROVIDER,'USES_TYPE',nearestSymbolByOffset(source,symbols,m.index||0),m[1],new Map(),{confidence:0.94}));return result;}
function callRelations(source,symbols){const result=[];for(const m of source.matchAll(/\b([A-Za-z_]\w*)::([A-Za-z_]\w*)\s*\(/g))result.push(relation(PROVIDER,'CALLS',nearestSymbolByOffset(source,symbols,m.index||0),m[2],new Map(),{targetQualifiedName:simpleName(m[1])+'.'+m[2],confidence:0.92}));return result;}
export { cFamilyResolver };
