const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'and', 'been', 'before', 'being', 'between', 'code',
  'current', 'does', 'for', 'from', 'have', 'implement', 'improve', 'into', 'keep', 'make', 'only',
  'project', 'relai', 'should', 'task', 'that', 'the', 'their', 'then', 'this', 'using', 'what', 'when',
  'where', 'which', 'with', 'without', 'work', 'would'
]);
const SHORT_TERMS = new Set(['ci', 'ui', 'ux']);

function relevanceTerms(value) {
  const terms = String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  return [...new Set(terms
    .map(normalizeTerm)
    .filter(term => (term.length >= 3 || SHORT_TERMS.has(term)) && !STOP_WORDS.has(term)))];
}

function matchingRelevanceTerms(queryTerms, value) {
  const candidates = relevanceTerms(value);
  if (!queryTerms.length || !candidates.length) return [];
  return queryTerms.filter(query => candidates.some(candidate => relatedTerms(query, candidate)));
}

function relatedTerms(left, right) {
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 4) return false;
  return left.startsWith(right) || right.startsWith(left);
}

function normalizeTerm(value) {
  let term = String(value || '').trim();
  if (term.length > 6 && term.endsWith('ing')) term = term.slice(0, -3);
  else if (term.length > 5 && term.endsWith('ed')) term = term.slice(0, -2);
  else if (term.length > 5 && term.endsWith('es')) term = term.slice(0, -2);
  else if (term.length > 4 && term.endsWith('s')) term = term.slice(0, -1);
  return term;
}

export { matchingRelevanceTerms, relevanceTerms };
