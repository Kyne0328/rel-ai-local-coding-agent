const COMPLEMENT = Object.freeze({
  HTTP_CALLS: 'HANDLES',
  HANDLES: 'HTTP_CALLS',
  EMITS: 'LISTENS_ON',
  LISTENS_ON: 'EMITS'
});

const GENERIC_PLATFORM_EVENTS = new Set([
  'abort', 'aborted', 'beforeunload', 'blur', 'change', 'click', 'close', 'connect',
  'connection', 'data', 'domcontentloaded', 'drain', 'end', 'error', 'finish', 'focus',
  'hashchange', 'input', 'keydown', 'keypress', 'keyup', 'load', 'message', 'mousedown',
  'mouseenter', 'mouseleave', 'mousemove', 'mouseout', 'mouseover', 'mouseup', 'offline',
  'online', 'open', 'pointerdown', 'pointermove', 'pointerup', 'popstate', 'ready', 'request',
  'resize', 'response', 'scroll', 'storage', 'submit', 'timeout', 'touchend', 'touchmove',
  'touchstart', 'unload', 'visibilitychange'
]);

function relationshipKey(type, targetName) {
  const value = String(targetName || '').trim();
  if (!value) return '';
  if (type === 'HTTP_CALLS' || type === 'HANDLES') return canonicalHttpKey(value);
  if (type === 'EMITS' || type === 'LISTENS_ON') {
    const eventName = value.replace(/^event:/i, '').trim();
    if (!eventName || GENERIC_PLATFORM_EVENTS.has(eventName.toLowerCase())) return '';
    return `event:${eventName}`;
  }
  return value;
}

function canonicalHttpKey(value) {
  const match = String(value || '').match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/i);
  if (!match) return '';
  let target = match[2].trim();
  try {
    if (/^https?:\/\//i.test(target)) target = new URL(target).pathname;
  } catch { return ''; }
  target = target.split(/[?#]/, 1)[0].replace(/\/{2,}/g, '/');
  if (!target.startsWith('/')) return '';
  if (target.length > 1) target = target.replace(/\/$/, '');
  return `${match[1].toUpperCase()} ${target}`;
}

export { COMPLEMENT, canonicalHttpKey, relationshipKey };
