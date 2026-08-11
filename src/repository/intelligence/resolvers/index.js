import { javascriptTypeResolver } from './javascript.js';

const RESOLVERS = new Map([
  ['javascript', javascriptTypeResolver],
  ['typescript', javascriptTypeResolver],
  ['tsx', javascriptTypeResolver]
]);

function resolverForLanguage(language) {
  return RESOLVERS.get(String(language || '').toLowerCase()) || null;
}

function resolverLanguages() {
  return [...RESOLVERS.keys()].sort((left, right) => left.localeCompare(right));
}

export { resolverForLanguage, resolverLanguages };
