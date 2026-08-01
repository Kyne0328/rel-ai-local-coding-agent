const STATUS_TONES = Object.freeze({
  danger: ['fail', 'error', 'denied', 'blocked', 'invalid', 'unavailable'],
  warning: ['pending', 'warn', 'approval', 'authentication_required', 'input_required', 'retry', 'rate-limit', 'degraded', 'partial', 'incomplete'],
  information: ['run', 'active', 'starting', 'stopping', 'connecting', 'reconnecting', 'open', 'wait', 'settling', 'queued'],
  success: ['ready', 'success', 'succeeded', 'complete', 'available', 'connected', 'passed'],
  neutral: ['cancel', 'disconnect', 'expired', 'unknown', 'inactive', 'idle', 'stopped']
});

function pillClass(value) {
  const status = String(value || 'unknown').toLowerCase();
  if (status === 'false' || STATUS_TONES.danger.some(token => status.includes(token))) return 'bad';
  if (STATUS_TONES.warning.some(token => status.includes(token))) return 'warn';
  if (STATUS_TONES.neutral.some(token => status.includes(token))) return '';
  if (STATUS_TONES.information.some(token => status.includes(token))) return 'working';
  if (STATUS_TONES.success.some(token => status.includes(token))) return 'ok';
  return '';
}

function toneLabel(className) {
  if (className === 'bad') return 'danger';
  if (className === 'warn') return 'warning';
  if (className === 'working') return 'information';
  if (className === 'ok') return 'success';
  return 'neutral';
}

export function Pill(value, extraClass = '') {
  const cls = pillClass(value);
  const el = document.createElement('span');
  el.className = `status-pill ${cls} ${extraClass}`.trim();
  el.textContent = String(value || 'unknown');
  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = ` (${toneLabel(cls)})`;
  el.appendChild(sr);
  return el;
}

export function pillHtml(value) {
  const cls = pillClass(value);
  return `<span class="status-pill ${cls}">${esc(String(value || 'unknown'))}<span class="sr-only"> (${toneLabel(cls)})</span></span>`;
}

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
