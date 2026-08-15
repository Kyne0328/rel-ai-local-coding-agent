const DASHBOARD_TASK_EVENT_COALESCE_MS = 50;

function createDashboardTaskEventBatcher(options = {}) {
  const delayMs = Math.max(0, Number(options.delayMs ?? DASHBOARD_TASK_EVENT_COALESCE_MS));
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const onFlush = typeof options.onFlush === 'function' ? options.onFlush : () => {};
  const pending = new Map();
  let timer = null;
  let revision = 0;

  function push(activity = {}) {
    revision = Math.max(revision, Number(activity.revision || 0));
    pending.set(activityKey(activity), activity);
    if (timer) return;
    timer = setTimer(flush, delayMs);
    timer?.unref?.();
  }

  function flush() {
    if (timer) clearTimer(timer);
    timer = null;
    if (!pending.size) return false;
    const activities = [...pending.values()];
    pending.clear();
    const batchRevision = revision;
    revision = 0;
    onFlush({ revision: batchRevision, activities });
    return true;
  }

  function close() {
    if (timer) clearTimer(timer);
    timer = null;
    pending.clear();
    revision = 0;
  }

  return { push, flush, close, pendingCount: () => pending.size };
}

function activityKey(activity = {}) {
  const taskId = String(activity.taskId || activity.task?.taskId || activity.task?.id || 'observed');
  const eventId = String(activity.activityEvent?.eventId || activity.activityEvent?.operationId || '');
  return eventId ? `${taskId}:event:${eventId}` : `${taskId}:phase:${String(activity.phase || 'update')}`;
}

export { DASHBOARD_TASK_EVENT_COALESCE_MS, createDashboardTaskEventBatcher };
