import { javaResolver } from './java.js';
import { csharpResolver } from './csharp.js';
import { goResolver } from './go.js';
import { rustResolver } from './rust.js';
import { cFamilyResolver } from './cFamily.js';
import { phpResolver } from './php.js';
import { kotlinResolver } from './kotlin.js';
import { javascriptTypeResolver } from './javascript.js';
import { pythonResolver } from './python.js';

const RESOLVERS = new Map([
  ['kotlin', kotlinResolver],
  ['php', phpResolver],
  ['cpp', cFamilyResolver],
  ['c', cFamilyResolver],
  ['rust', rustResolver],
  ['go', goResolver],
  ['csharp', csharpResolver],
  ['java', javaResolver],
  ['javascript', javascriptTypeResolver],
  ['python', pythonResolver],
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
