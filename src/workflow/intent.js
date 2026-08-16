import { WORKFLOW_INTENTS } from './contracts.js';

const TASK_INTENT_SET = new Set(WORKFLOW_INTENTS);

function normalizeTaskIntent(value, fallback = 'auto') {
  const intent = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (TASK_INTENT_SET.has(intent)) return intent;
  return TASK_INTENT_SET.has(fallback) ? fallback : 'auto';
}

function classifyTaskIntent(objective) {
  const text = String(objective || '').trim().toLowerCase();
  if (!text) return 'auto';
  const rules = [
    ['review', 6, /\b(review|audit|assess|evaluate)\b/g],
    ['investigation', 6, /\b(investigat|diagnos|analy[sz]e|explain|trace|understand|inspect)\w*\b/g],
    ['migration', 5, /\b(migrat(?:e|ion)|hard cutover|cutover|upgrade)\b/g],
    ['bugfix', 5, /\b(fix|bug|broken|failing|failure|error|regression|crash|incorrect|wrong)\w*\b/g],
    ['refactor', 5, /\b(refactor|restructure|reorganize|decouple|consolidate|single source of truth|deduplicat)\w*\b/g],
    ['cleanup', 5, /\b(cleanup|clean up|remove (?:dead|stale|unused)|residue|simplif(?:y|ication))\b/g],
    ['documentation', 5, /\b(documentation|docs?|readme|changelog)\b/g],
    ['release', 5, /\b(release|publish|ship|distribution)\b/g],
    ['performance', 4, /\b(performance|optimi[sz]e|latency|throughput|hot[- ]?path|faster|speed up)\w*\b/g],
    ['feature', 3, /\b(add|implement|create|introduce|support|feature|build)\w*\b/g]
  ];
  const ranked = rules.map(([intent, weight, pattern], order) => {
    const matches = [...text.matchAll(pattern)].length;
    return { intent, score: matches * weight, order };
  }).filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order);
  return ranked[0]?.intent || 'other';
}

export { classifyTaskIntent, normalizeTaskIntent };
