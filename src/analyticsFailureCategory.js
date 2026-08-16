const ANALYTICS_FAILURE_CATEGORIES = Object.freeze([
  'cancelled',
  'timeout',
  'authorization',
  'capacity',
  'transport',
  'policy',
  'workspace',
  'git',
  'process',
  'validation',
  'runtime'
]);

const ANALYTICS_FAILURE_CATEGORY_SET = new Set(ANALYTICS_FAILURE_CATEGORIES);

function failureCategoryFromCode(value) {
  const code = String(value || '').trim().toUpperCase().slice(0, 160);
  if (/CANCEL|ABORT/.test(code)) return 'cancelled';
  if (/TIMEOUT|DEADLINE|EXPIRED/.test(code)) return 'timeout';
  if (/AUTH|OAUTH|TOKEN|UNAUTHORIZED|FORBIDDEN|PRINCIPAL|GRANT|PAIRING/.test(code)) return 'authorization';
  if (/RATE_LIMIT|CONCURRENCY|BUSY|CAPACITY/.test(code)) return 'capacity';
  if (/DEVICE_OFFLINE|TRANSPORT|CONNECTION|SOCKET|AMBIGUOUS_RESULT|RESULT_UNAVAILABLE|GATEWAY/.test(code)) return 'transport';
  if (/POLICY|SENSITIVE|PROTECTED|APPROVAL|CAUTION|RESTRICTED|DENIED/.test(code)) return 'policy';
  if (/WORKSPACE|PATH|FILE|DIRECTORY|SYMLINK/.test(code)) return 'workspace';
  if (/GIT|MERGE|CONFLICT|BRANCH|COMMIT|REMOTE/.test(code)) return 'git';
  if (/PROCESS|EXEC|COMMAND|SPAWN/.test(code)) return 'process';
  if (/VALIDATION|SCHEMA|INVALID|PROTOCOL|PARSE|INPUT|ARGUMENT/.test(code)) return 'validation';
  return 'runtime';
}

function normalizeFailureCategory(value) {
  const category = String(value || '').trim().toLowerCase();
  return ANALYTICS_FAILURE_CATEGORY_SET.has(category) ? category : 'runtime';
}

export { failureCategoryFromCode, normalizeFailureCategory };
