const CANONICAL_PATHS = new Set([
  'home',
  'tasks',
  'workspaces',
  'processes',
  'activity',
  'tools',
  'settings',
  'settings/connection',
  'settings/tools-validation',
  'settings/diagnostics',
  'settings/advanced',
  'settings/about'
]);

const PATH_ALIASES = new Map([
  ['', 'home'],
  ['reference', 'tools'],
  ['connection', 'settings/connection'],
  ['connector', 'settings/connection'],
  ['diagnostics', 'settings/diagnostics'],
  ['settings/general', 'settings'],
  ['settings/connector', 'settings/connection'],
  ['settings/desktop', 'settings/connection'],
  ['settings/dashboard', 'settings/advanced']
]);

const ALLOWED_PARAMS = {
  home: new Set(['workspace']),
  tasks: new Set(['workspace']),
  workspaces: new Set(['workspace', 'focus']),
  processes: new Set(['workspace']),
  activity: new Set(['workspace', 'search', 'time', 'tool', 'status', 'task', 'event']),
  'settings/diagnostics': new Set(['workspace'])
};

const SENSITIVE_PARAM = /(?:token|secret|password|credential|bootstrap|authorization|auth|api[_-]?key|access[_-]?key|refresh[_-]?key)/i;
const WORKSPACE_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const TIME_RANGES = new Set(['15m', '1h', '24h', '7d', 'all']);
const STATUSES = new Set(['ok', 'error']);

export function normalizeRouteKey(value) {
  const raw = String(value || '').replace(/^#/, '');
  const separator = raw.indexOf('?');
  const requestedPath = normalizePath(separator >= 0 ? raw.slice(0, separator) : raw);
  const resolved = resolvePath(requestedPath);
  const input = new URLSearchParams(resolved.recognized && separator >= 0 ? raw.slice(separator + 1) : '');
  const output = sanitizeParams(resolved.path, input);
  const query = output.toString();
  return `${resolved.path}${query ? `?${query}` : ''}`;
}

export function canonicalPathFor(value) {
  return resolvePath(normalizePath(value)).path;
}

export function routeAllowsParam(path, key) {
  return ALLOWED_PARAMS[canonicalPathFor(path)]?.has(key) === true;
}

function resolvePath(path) {
  const aliased = PATH_ALIASES.get(path) || path;
  const recognized = CANONICAL_PATHS.has(aliased);
  return { path: recognized ? aliased : 'home', recognized };
}

function normalizePath(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
    .toLowerCase();
}

function sanitizeParams(path, input) {
  const allowed = ALLOWED_PARAMS[path] || new Set();
  const output = new URLSearchParams();
  for (const [key, rawValue] of input) {
    if (!allowed.has(key) || SENSITIVE_PARAM.test(key) || output.has(key)) continue;
    const value = sanitizeValue(key, rawValue);
    if (value) output.set(key, value);
  }
  if (output.get('focus') === '1' && !output.get('workspace')) output.delete('focus');
  return output;
}

function sanitizeValue(key, value) {
  const text = stripControlCharacters(value).trim();
  if (!text) return '';
  if (key === 'workspace') return WORKSPACE_PATTERN.test(text) ? text : '';
  if (key === 'focus') return text === '1' ? '1' : '';
  if (key === 'time') return TIME_RANGES.has(text.toLowerCase()) ? text.toLowerCase() : '';
  if (key === 'status') return STATUSES.has(text.toLowerCase()) ? text.toLowerCase() : '';
  const limit = key === 'search' ? 200 : 160;
  return text.slice(0, limit);
}

function stripControlCharacters(value) {
  return Array.from(String(value || ''))
    .filter(character => {
      const code = character.codePointAt(0);
      return code > 31 && code !== 127;
    })
    .join('');
}
