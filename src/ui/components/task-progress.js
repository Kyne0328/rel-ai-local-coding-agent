import { esc } from '../utils.js';

const STATIC_PROGRESS_STATES = Object.freeze({
  failed: Object.freeze({ fallback: 'Task failed', state: 'Failed', className: 'terminal failed' }),
  attention: Object.freeze({ fallback: 'Task failed', state: 'Failed', className: 'terminal failed' }),
  cancelled: Object.freeze({ fallback: 'Task ended without completion', state: 'Ended', className: 'terminal cancelled' }),
  inactive: Object.freeze({ fallback: 'Task ended without completion', state: 'Ended', className: 'terminal cancelled' }),
  expired: Object.freeze({ fallback: 'Task ended without completion', state: 'Ended', className: 'terminal cancelled' }),
  validation_failed: Object.freeze({ fallback: 'Fix issues and revalidate', state: 'Action required', className: 'paused failed' }),
  blocked: Object.freeze({ fallback: 'Resolve the blocker to continue', state: 'Action required', className: 'paused blocked' }),
  waiting_for_approval: Object.freeze({ fallback: 'Approval required', state: 'Paused', className: 'paused approval' })
});

export function taskProgressHtml(progress = {}, status = '', options = {}) {
  const compact = options.compact === true;
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (progress?.mode === 'complete' && normalizedStatus === 'completed') {
    return `<div class="task-progress complete ${compact ? 'compact' : ''}"><div class="task-progress-label"><span>${esc(progress.label || 'Complete')}</span><strong>100%</strong></div><progress class="task-progress-track" aria-label="Task complete" value="100" max="100"></progress></div>`;
  }
  const staticState = STATIC_PROGRESS_STATES[normalizedStatus];
  if (staticState) return staticProgressHtml(progress, staticState, compact);
  if (progress?.mode === 'determinate') {
    const value = clampPercentage(progress.percentage);
    const label = progress.label || `${progress.completedUnits || 0} of ${progress.totalUnits || 0} complete`;
    return `<div class="task-progress ${compact ? 'compact' : ''}"><div class="task-progress-label"><span>${esc(label)}</span><strong>${value}%</strong></div><progress class="task-progress-track" aria-label="${esc(label)}" value="${value}" max="100"></progress></div>`;
  }
  const label = progress?.label || 'Workload size is not yet known';
  const statusAttributes = compact ? `aria-label="${esc(label)}"` : `role="status" aria-label="${esc(label)}"`;
  return `<div class="task-progress indeterminate ${compact ? 'compact' : ''}" ${statusAttributes}><div class="task-progress-label"><span>${esc(label)}</span></div><div class="task-progress-track" aria-hidden="true"></div></div>`;
}

function staticProgressHtml(progress, state, compact) {
  const terminal = state.className.startsWith('terminal');
  const label = terminal ? state.fallback : meaningfulLabel(progress?.label, state.fallback);
  const classes = `task-progress static ${state.className} ${compact ? 'compact' : ''}`.trim();
  return `<div class="${classes}" role="status" aria-label="${esc(`${label}. ${state.state}.`)}"><div class="task-progress-label"><span>${esc(label)}</span><strong>${esc(state.state)}</strong></div></div>`;
}

function meaningfulLabel(value, fallback) {
  const label = String(value || '').trim();
  if (!label || /^(progress unavailable|workload size is not yet known|planning task|waiting for the next task step)$/i.test(label)) return fallback;
  return label;
}

function clampPercentage(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}
