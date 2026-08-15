function resolveQueryTerms(args = {}, options = {}) {
  const singleField = String(options.singleField || 'query');
  const label = String(options.label || singleField);
  const maxLength = Number(options.maxLength) || 1000;
  const maxItems = Number(options.maxItems) || 4;
  const single = typeof args[singleField] === 'string' ? args[singleField] : '';
  const batch = Array.isArray(args.queries) ? args.queries : null;

  if (batch && single.trim()) {
    throw new Error(`Provide ${singleField} or queries, not both.`);
  }
  if (!batch) return { batched: false, terms: [single] };
  if (batch.length < 1 || batch.length > maxItems) {
    throw new Error(`${label} queries must contain between 1 and ${maxItems} items.`);
  }

  const terms = [];
  const seen = new Set();
  for (const value of batch) {
    const term = String(value || '');
    if (!term.trim()) throw new Error(`${label} queries must not contain empty values.`);
    if (term.length > maxLength) throw new Error(`${label} queries must be ${maxLength} characters or fewer.`);
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return { batched: true, terms };
}

function splitBatchLimit(value, { min, max, fallback, count }) {
  const numeric = Number(value);
  const total = Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.floor(numeric))) : fallback;
  return Math.max(min, Math.floor(total / Math.max(1, count)));
}

function compactBatchResult(value) {
  if (!value || typeof value !== 'object') return value;
  const { ok: _ok, workspace: _workspace, next: _next, ...rest } = value;
  return rest;
}

function summarizeBatchResults(results = []) {
  const files = new Set();
  let matchCount = 0;
  let resultCount = 0;
  let returnedBytes = 0;
  let truncated = false;
  for (const result of results) {
    matchCount += Number(result?.matchCount) || 0;
    resultCount += Number(result?.resultCount) || (Array.isArray(result?.matches) ? result.matches.length : 0);
    returnedBytes += Number(result?.returnedBytes) || 0;
    truncated ||= result?.truncated === true || result?.contextTruncated === true;
    for (const match of result?.matches || []) if (match?.path) files.add(String(match.path));
    for (const item of result?.results || []) if (item?.path) files.add(String(item.path));
    for (const file of result?.files || []) {
      const path = typeof file === 'string' ? file : file?.path;
      if (path) files.add(String(path));
    }
  }
  return { matchCount, resultCount, returnedBytes, uniqueFileCount: files.size, truncated };
}

export { compactBatchResult, resolveQueryTerms, splitBatchLimit, summarizeBatchResults };
