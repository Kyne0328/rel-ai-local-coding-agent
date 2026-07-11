'use strict';

function createToolSleepBlocker(powerSaveBlocker) {
  if (!powerSaveBlocker || typeof powerSaveBlocker.start !== 'function') {
    throw new TypeError('A valid Electron powerSaveBlocker is required.');
  }

  let blockerId = null;

  function update(activeConnectorCalls) {
    if (Number(activeConnectorCalls) > 0) start();
    else stop();
  }

  function start() {
    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) return blockerId;
    blockerId = powerSaveBlocker.start('prevent-app-suspension');
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
    isReady = () => true,
    onNotificationClick = () => {},
    onStatusChange = () => {}
  } = options;
  const blocker = createToolSleepBlocker(powerSaveBlocker);
  let notificationsEnabled = true;

  const unsubscribe = toolActivity.onToolActivity(handleActivity);
  blocker.update(toolActivity.getToolActivity?.().activeConnectorCalls || 0);
  emitStatus();

  function handleActivity(event) {
    blocker.update(event.activeConnectorCalls);
    if (event.phase === 'completed' && event.task) showCompletionNotification(event.task);
    emitStatus();
  }

  function showCompletionNotification(task) {
    if (!notificationsEnabled || !isReady()) return;
    if (typeof Notification?.isSupported === 'function' && !Notification.isSupported()) return;
    const failed = task.status === 'attention';
    const title = failed ? 'Rel.AI task needs attention' : 'Rel.AI task completed';
    const location = task.workspace ? ` in ${task.workspace}` : '';
    const callLabel = task.calls === 1 ? 'tool call' : 'tool calls';
    const count = `${task.calls} ${callLabel}`;
    let body = `ChatGPT finished ${count}${location}.`;
    if (failed) {
      const failureLabel = task.failures === 1 ? 'failure' : 'failures';
      body = `ChatGPT finished ${count}${location}, with ${task.failures} ${failureLabel}.`;
    }
    const notification = new Notification({ title, body, silent: false });
    if (typeof notification.on === 'function') notification.on('click', onNotificationClick);
    notification.show();
  }

  function currentStatus() {
    const activity = toolActivity.getToolActivity?.() || {};
    return {
      state: activity.state || 'idle',
      activeCalls: Number(activity.activeConnectorCalls || activity.activeCalls || 0),
      activeTaskCount: Number(activity.activeTaskCount || activity.tasks?.length || 0),
      tasks: Array.isArray(activity.tasks) ? activity.tasks : [],
      taskId: activity.taskId || '',
      calls: Number(activity.calls || 0),
      failures: Number(activity.failures || 0),
      workspace: activity.workspace || '',
      tool: activity.tool || '',
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

  function stop() {
    unsubscribe();
    blocker.stop();
  }

  return {
    getStatus: currentStatus,
    getNotificationsEnabled: () => notificationsEnabled,
    setNotificationsEnabled,
    stop
  };
}

module.exports = {
  createToolSleepBlocker,
  createTaskActivityRuntime
};
