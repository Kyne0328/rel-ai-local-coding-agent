const DEFAULT_RRF_K = 60;

function reciprocalRankFusion(resultLists, { k = DEFAULT_RRF_K, limit = 200 } = {}) {
  const fused = new Map();
  for (const list of resultLists.filter(Array.isArray)) {
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      const key = candidateKey(item);
      if (!key) continue;
      const current = fused.get(key) || { ...item, providers: [], reasons: [], rrfScore: 0 };
      current.rrfScore += 1 / (k + index + 1);
      current.providers = unique([...current.providers, ...(item.providers || []), item.provider].filter(Boolean));
      current.reasons = unique([...current.reasons, ...(item.reasons || [])]);
      if (item.structuralScore != null) current.structuralScore = Math.max(Number(current.structuralScore || 0), Number(item.structuralScore || 0));
      fused.set(key, current);
    }
  }
  return [...fused.values()]
    .map(item => ({ ...item, score: item.rrfScore + Number(item.structuralScore || 0) }))
    .sort((left, right) => right.score - left.score || String(left.path || '').localeCompare(String(right.path || '')))
    .slice(0, limit);
}

function candidateKey(item) {
  if (!item) return '';
  return [item.path || '', item.symbol || '', item.line || 0].join(':');
}

function unique(values) {
  return [...new Set(values)];
}

export { reciprocalRankFusion };