import { esc } from '../utils.js';

export function taskProgressHtml(progress = {}, status = '', options = {}) {
  const compact = options.compact === true;
  if (progress?.mode === 'determinate') {
    const value = clampPercentage(progress.percentage);
    const label = progress.label || `${progress.completedUnits || 0} of ${progress.totalUnits || 0} complete`;
    return `<div class="task-progress ${compact ? 'compact' : ''}"><div class="task-progress-label"><span>${esc(label)}</span><strong>${value}%</strong></div><progress class="task-progress-track" aria-label="${esc(label)}" value="${value}" max="100"></progress></div>`;
  }
  if (progress?.mode === 'complete' && ['completed', 'completed_with_warnings'].includes(status)) {
    return `<div class="task-progress ${compact ? 'compact' : ''}"><div class="task-progress-label"><span>${esc(progress.label || 'Complete')}</span><strong>100%</strong></div><progress class="task-progress-track" aria-label="Task complete" value="100" max="100"></progress></div>`;
  }
  const label = progress?.label || 'Workload size is not yet known';
  const statusAttributes = compact ? `aria-label="${esc(label)}"` : `role="status" aria-label="${esc(label)}"`;
  return `<div class="task-progress indeterminate ${compact ? 'compact' : ''}" ${statusAttributes}><div class="task-progress-label"><span>${esc(label)}</span></div><progress class="task-progress-track" aria-hidden="true"></progress></div>`;
}

function clampPercentage(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}
