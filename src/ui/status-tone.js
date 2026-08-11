const EXACT_STATUS_TONES = Object.freeze({
  active: 'information',
  approval: 'warning',
  attention: 'danger',
  available: 'success',
  blocked: 'danger',
  cancelled: 'neutral',
  capability_mismatch: 'warning',
  check: 'warning',
  checking: 'information',
  complete: 'success',
  completed: 'success',
  connected: 'success',
  connecting: 'information',
  degraded: 'warning',
  denied: 'danger',
  disabled: 'neutral',
  disconnected: 'neutral',
  downloaded: 'success',
  downloading: 'information',
  error: 'danger',
  exited: 'success',
  expired: 'neutral',
  failed: 'danger',
  idle: 'neutral',
  inactive: 'neutral',
  info: 'information',
  input_required: 'warning',
  installing: 'information',
  invalid: 'danger',
  live: 'information',
  needs_attention: 'danger',
  not_configured: 'warning',
  offline: 'neutral',
  open: 'information',
  orphaned: 'warning',
  partial: 'warning',
  passed: 'success',
  paused: 'warning',
  pending: 'warning',
  planning: 'information',
  queued: 'information',
  ready: 'success',
  reauthentication_required: 'warning',
  reconnecting: 'information',
  rejected: 'danger',
  retry: 'warning',
  running: 'information',
  settling: 'information',
  stale: 'warning',
  starting: 'information',
  stopped: 'neutral',
  stopping: 'information',
  succeeded: 'success',
  success: 'success',
  unavailable: 'danger',
  unknown: 'neutral',
  unsupported: 'warning',
  up_to_date: 'success',
  validating: 'information',
  validation_failed: 'danger',
  waiting: 'information',
  waiting_for_approval: 'warning',
  warn: 'warning',
  warning: 'warning',
  working: 'information'
});

const FALLBACK_TERMS = Object.freeze({
  danger: ['fail', 'error', 'denied', 'blocked', 'invalid', 'unavailable', 'rejected', 'critical', 'attention'],
  warning: ['pending', 'warn', 'approval', 'authentication_required', 'input_required', 'retry', 'rate_limit', 'degraded', 'partial', 'incomplete', 'paused', 'stale', 'mismatch', 'orphaned', 'unsupported', 'not_configured', 'check'],
  neutral: ['cancel', 'disconnect', 'expired', 'unknown', 'inactive', 'idle', 'stopped', 'disabled', 'offline'],
  information: ['validating', 'planning', 'run', 'active', 'starting', 'stopping', 'connecting', 'reconnecting', 'open', 'wait', 'settling', 'queued', 'working', 'live', 'checking', 'downloading', 'installing', 'info'],
  success: ['ready', 'success', 'succeeded', 'complete', 'available', 'connected', 'passed', 'up_to_date', 'downloaded', 'exited', 'enabled']
});

const PILL_CLASSES = Object.freeze({
  danger: 'bad',
  warning: 'warn',
  information: 'working',
  success: 'ok',
  neutral: ''
});

const DOT_CLASSES = Object.freeze({
  danger: 'bad',
  warning: 'warn',
  information: 'info',
  success: '',
  neutral: 'neutral'
});

function normalizeStatus(value) {
  return String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function statusTone(value) {
  const status = normalizeStatus(value);
  if (status === 'false') return 'danger';
  if (Object.hasOwn(EXACT_STATUS_TONES, status)) return EXACT_STATUS_TONES[status];
  for (const tone of ['danger', 'warning', 'neutral', 'information', 'success']) {
    if (FALLBACK_TERMS[tone].some(term => status.includes(term))) return tone;
  }
  return 'neutral';
}

function statusPillClass(value) {
  return PILL_CLASSES[statusTone(value)];
}

function statusDotClass(value) {
  return DOT_CLASSES[statusTone(value)];
}

export {   statusDotClass, statusPillClass, statusTone };
