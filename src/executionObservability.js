import { setSpanAttributes } from './telemetry.js';
import { updateCurrentToolActivity } from './toolActivity.js';
import { sanitizeDisplayText } from './taskObservability.js';

function createExecutionPlanObserver(options = {}) {
  const running = new Map();
  const update = typeof options.update === 'function' ? options.update : updateCurrentToolActivity;
  const source = sanitizeDisplayText(options.source || 'execution', 80) || 'execution';
  const title = sanitizeDisplayText(options.title || 'Running parallel work', 160) || 'Running parallel work';
  const noun = sanitizeDisplayText(options.noun || 'steps', 40) || 'steps';
  const category = sanitizeDisplayText(options.category || 'execution', 80) || 'execution';

  return (event = {}) => {
    if (event.type === 'step_started') running.set(event.name, displayName(event));
    if (event.type === 'step_completed') running.delete(event.name);

    const total = Math.max(0, Number(event.total) || 0);
    const completed = Math.min(total, Math.max(0, Number(event.completed) || 0));
    const active = running.size;
    const pending = Math.max(0, total - completed - active);
    const names = [...running.values()].filter(Boolean).slice(0, 3);
    const activity = active > 1
      ? `${active} ${noun} running${names.length ? `: ${names.join(', ')}` : ''}`
      : active === 1
        ? `Running ${names[0] || noun}`
        : completed < total
          ? `${completed} of ${total} ${noun} completed`
          : `${total} ${noun} completed`;

    update({
      currentStage: active > 1 ? `${active} ${noun} running in parallel` : title,
      currentActivity: activity,
      detail: activity,
      progress: {
        mode: 'determinate',
        completedUnits: completed,
        totalUnits: total,
        percentage: total ? Math.round((completed / total) * 100) : 0,
        source,
        label: `${completed} of ${total} ${noun}`
      },
      activity: {
        category,
        status: 'running',
        title,
        summary: activity,
        metadata: {
          parallelActiveCount: active,
          completedCount: completed,
          pendingCount: pending,
          totalCount: total,
          running: names
        }
      }
    });
  };
}

function executionMetricAttributes(kind, metrics = {}) {
  const prefix = 'relai.plan';
  return {
    [`${prefix}.kind`]: sanitizeDisplayText(kind || 'execution', 80),
    [`${prefix}.total_steps`]: number(metrics.stepCount),
    [`${prefix}.parallel_groups`]: number(metrics.parallelGroupCount),
    [`${prefix}.max_concurrent_steps`]: number(metrics.maxConcurrentSteps),
    [`${prefix}.wall_time_ms`]: number(metrics.wallTimeMs),
    [`${prefix}.accumulated_step_time_ms`]: number(metrics.accumulatedStepTimeMs),
    [`${prefix}.overlap_time_ms`]: number(metrics.overlapTimeMs)
  };
}

function recordExecutionPlanMetrics(kind, metrics = {}) {
  setSpanAttributes(executionMetricAttributes(kind, metrics));
}

function displayName(event) {
  return sanitizeDisplayText(event?.metadata?.displayName || event?.name || 'step', 120);
}

function number(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

export { createExecutionPlanObserver, executionMetricAttributes, recordExecutionPlanMetrics };
