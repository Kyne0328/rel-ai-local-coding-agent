

const NOTIFICATION_BODY_LIMIT = 260;
const NOTIFICATION_SUMMARY_LIMIT = 150;
const NOTIFICATION_ERROR_LIMIT = 170;

function cleanNotificationText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateNotificationText(value, limit) {
  const text = cleanNotificationText(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function buildFailureNotification(event = {}) {
  const operation = truncateNotificationText(event.operation || event.tool || 'Workspace action', 80);
  const workspace = truncateNotificationText(event.workspace, 64);
  const error = truncateNotificationText(event.error, NOTIFICATION_ERROR_LIMIT);
  const location = workspace ? ` in ${workspace}` : '';
  const detail = error ? ` ${error}` : ' Open Rel.AI for details.';
  return {
    title: 'Workspace action failed',
    body: truncateNotificationText(`${operation} failed${location}.${detail}`, NOTIFICATION_BODY_LIMIT)
  };
}

function buildCompletionNotification(task = {}) {
  const summary = truncateNotificationText(task.summary, NOTIFICATION_SUMMARY_LIMIT);
  const workspace = truncateNotificationText(task.workspace, 64);
  const validationLevel = truncateNotificationText(task.validationLevel, 24).toLowerCase();
  const parts = [summary || 'The coding task completed successfully.'];
  if (workspace) parts.push(`Workspace: ${workspace}.`);
  parts.push(validationLevel ? `Final ${validationLevel} checks passed.` : 'Final checks passed.');
  return {
    title: 'Task completed',
    body: truncateNotificationText(parts.join(' '), NOTIFICATION_BODY_LIMIT)
  };
}

function createToolSleepBlocker(powerSaveBlocker) {
  if (!powerSaveBlocker || typeof powerSaveBlocker.start !== 'function') {
    throw new TypeError('A valid Electron powerSaveBlocker is required.');
  }

  let blockerId = null;

  function update(activeWorkCount) {
    if (Number(activeWorkCount) > 0) start();
    else stop();
  }

  function start() {
    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) return blockerId;
    blockerId = powerSaveBlocker.start('prevent-display-sleep');
    return blockerId;
  }

  function stop() {
    if (blockerId === null) return false;
    const id = blockerId;
    blockerId = null;
    if (!powerSaveBlocker.isStarted(id)) return false;
    return powerSaveBlocker.stop(id);
  }

  function isActive() {
    return blockerId !== null && powerSaveBlocker.isStarted(blockerId);
  }

  return { update, stop, isActive };
}

function createTaskActivityRuntime(options) {
  const {
    toolActivity,
    powerSaveBlocker,
    Notification,
    iconPath = '',
    isReady = () => true,
    onNotificationClick = () => {},
    onTaskCompleted = () => {},
    onStatusChange = () => {}
  } = options;
  const blocker = createToolSleepBlocker(powerSaveBlocker);
  let notificationsEnabled = true;

  const unsubscribe = toolActivity.onToolActivity(handleActivity);
  syncBlocker();
  emitStatus();

  function handleActivity(event) {
    syncBlocker();
    if (event.phase === 'finished' && event.ok === false) showFailureNotification(event);
    if (event.phase === 'completed' && event.task?.completionKnown === true) {
      showCompletionNotification(event.task);
      onTaskCompleted(event.task);
    }
    emitStatus();
  }

  function syncBlocker() {
    const activity = toolActivity.getToolActivity?.() || {};
    const activeCalls = Number(Object.hasOwn(activity, 'activeConnectorCalls')
      ? activity.activeConnectorCalls
      : activity.activeCalls || 0);
    const reportedTaskCount = Number(activity.activeTaskCount);
    const activeTasks = Number.isFinite(reportedTaskCount)
      ? reportedTaskCount
      : Array.isArray(activity.tasks) ? activity.tasks.length : 0;
    blocker.update(Math.max(activeCalls, activeTasks));
  }

  function showNativeNotification(content) {
    if (!notificationsEnabled || !isReady()) return;
    if (typeof Notification?.isSupported === 'function' && !Notification.isSupported()) return;
    const options = { ...content, silent: false };
    if (iconPath) options.icon = iconPath;
    const notification = new Notification(options);
    if (typeof notification.on === 'function') notification.on('click', onNotificationClick);
    notification.show();
  }

  function showFailureNotification(event) {
    showNativeNotification(buildFailureNotification(event));
  }

  function showCompletionNotification(task) {
    showNativeNotification(buildCompletionNotification(task));
  }

  function currentStatus() {
    const activity = toolActivity.getToolActivity?.() || {};
    return {
      state: activity.state || 'idle',
      activeCalls: Number(activity.activeCalls || 0),
      activeTaskCount: Number(activity.activeTaskCount || activity.tasks?.length || 0),
      completionKnown: activity.completionKnown === true,
      tasks: Array.isArray(activity.tasks) ? activity.tasks : [],
      taskId: activity.taskId || '',
      calls: Number(activity.calls || 0),
      failures: Number(activity.failures || 0),
      workspace: activity.workspace || '',
      tool: activity.tool || '',
      operation: activity.operation || '',
      startedAt: activity.startedAt || null,
      lastTask: activity.lastTask || null
    };
  }

  function emitStatus() {
    onStatusChange(currentStatus());
  }

  function setNotificationsEnabled(value) {
    notificationsEnabled = Boolean(value);
    return notificationsEnabled;
  }

  function resetHistory() {
    const activity = toolActivity.getToolActivity?.() || {};
    if (Number(activity.activeCalls || 0) > 0) {
      return { ok: false, error: 'Cannot clear session history while a Rel.AI tool call is running.' };
    }
    toolActivity.resetToolActivity?.();
    syncBlocker();
    emitStatus();
    return { ok: true };
  }

  function stop() {
    unsubscribe();
    blocker.stop();
  }

  return {
    getStatus: currentStatus,
    getNotificationsEnabled: () => notificationsEnabled,
    setNotificationsEnabled,
    resetHistory,
    stop
  };
}

export { buildCompletionNotification, buildFailureNotification, cleanNotificationText, createToolSleepBlocker, createTaskActivityRuntime, truncateNotificationText };
