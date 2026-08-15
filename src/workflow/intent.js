const TASK_INTENTS = Object.freeze([
  'auto',
  'investigation',
  'bugfix',
  'feature',
  'refactor',
  'migration',
  'cleanup',
  'documentation',
  'performance',
  'review',
  'release',
  'other'
]);
const TASK_INTENT_SET = new Set(TASK_INTENTS);

function normalizeTaskIntent(value, fallback = 'auto') {
  const intent = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (TASK_INTENT_SET.has(intent)) return intent;
  return TASK_INTENT_SET.has(fallback) ? fallback : 'auto';
}

function classifyTaskIntent(objective) {
  const text = String(objective || '').trim().toLowerCase();
  if (!text) return 'auto';
  const rules = [
    ['migration', /\b(migrat(?:e|ion)|hard cutover|cutover|upgrade)\b/],
    ['performance', /\b(performance|optimi[sz]e|latency|throughput|hot[- ]?path|faster|speed up)\b/],
    ['bugfix', /\b(fix|bug|broken|failing|failure|error|regression|crash|incorrect|wrong)\b/],
    ['refactor', /\b(refactor|restructure|reorganize|decouple|consolidate|single source of truth|deduplicat)\b/],
    ['cleanup', /\b(cleanup|clean up|remove (?:dead|stale|unused)|residue|simplif(?:y|ication))\b/],
    ['documentation', /\b(documentation|docs?|readme|changelog)\b/],
    ['release', /\b(release|publish|ship|distribution)\b/],
    ['review', /\b(review|audit|assess|evaluate)\b/],
    ['investigation', /\b(investigat|diagnos|analy[sz]e|explain|trace|understand|inspect)\b/],
    ['feature', /\b(add|implement|create|introduce|support|feature|build)\b/]
  ];
  for (const [intent, pattern] of rules) {
    if (pattern.test(text)) return intent;
  }
  return 'other';
}

export { TASK_INTENTS, classifyTaskIntent, normalizeTaskIntent };
