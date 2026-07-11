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
    idleMs = 10000,
    isReady = () => true,
    onNotificationClick = () => {},
    onStatusChange = () => {},
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout
  } = options;
  const blocker = createToolSleepBlocker(powerSaveBlocker);
  let notificationsEnabled = true;
  let timer = null;
  let batch = null;
  let lastTask = null;
  let activeConnectorCalls = toolActivity.getToolActivity?.().activeConnectorCalls || 0;

  const unsubscribe = toolActivity.onToolActivity(handleActivity);
  emitStatus();

  function handleActivity(event) {
    activeConnectorCalls = Number(event.activeConnectorCalls) || 0;
    blocker.update(activeConnectorCalls);
    if (event.phase === 'started') beginTask(event);
    else if (event.phase === 'finished') finishCall(event);
  }

  function beginTask(event) {
    cancelTimer();
    batch ??= {
      calls: 0,
      failures: 0,
      workspace: '',
      lastTool: '',
      startedAt: now()
    };
    batch.calls += 1;
    batch.workspace = event.workspace || batch.workspace;
    batch.lastTool = event.tool || batch.lastTool;
    emitStatus(event.activeConnectorCalls);
  }

  function finishCall(event) {
    if (!batch) return;
    if (event.ok === false) batch.failures += 1;
    batch.workspace = event.workspace || batch.workspace;
    batch.lastTool = event.tool || batch.lastTool;
    if (Number(event.activeConnectorCalls) === 0) scheduleCompletion();
    emitStatus(event.activeConnectorCalls);
  }

  function scheduleCompletion() {
    cancelTimer();
    timer = setTimer(completeTask, idleMs);
  }

  function completeTask() {
    timer = null;
    if (!batch) return;
    const completedAt = now();
    lastTask = {
      status: batch.failures > 0 ? 'attention' : 'completed',
      calls: batch.calls,
      failures: batch.failures,
      workspace: batch.workspace,
      lastTool: batch.lastTool,
      startedAt: batch.startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - batch.startedAt)
    };
    const finished = lastTask;
    batch = null;
    emitStatus(0);
    showCompletionNotification(finished);
  }

  function showCompletionNotification(task) {
    if (!notificationsEnabled || !isReady()) return;
    if (typeof Notification?.isSupported === 'function' && !Notification.isSupported()) return;
    const failed = task.status === 'attention';
    const title = failed ? 'Rel.AI task needs attention' : 'Rel.AI task completed';
    const location = task.workspace ? ` in ${task.workspace}` : '';
    const count = `${task.calls} tool call${task.calls === 1 ? '' : 's'}`;
    const body = failed
      ? `ChatGPT finished ${count}${location}, with ${task.failures} failure${task.failures === 1 ? '' : 's'}.`
      : `ChatGPT finished ${count}${location}.`;
    const notification = new Notification({ title, body, silent: false });
    if (typeof notification.on === 'function') notification.on('click', onNotificationClick);
    notification.show();
  }

  function currentStatus(activeCallsOverride) {
    const activeCalls = Number.isFinite(activeCallsOverride) ? activeCallsOverride : activeConnectorCalls;
    return {
      state: batch ? (activeCalls > 0 ? 'working' : 'settling') : 'idle',
      activeCalls,
      workspace: batch?.workspace || '',
      tool: batch?.lastTool || '',
      startedAt: batch?.startedAt || null,
      lastTask
    };
  }

  function emitStatus(activeConnectorCalls) {
    onStatusChange(currentStatus(activeConnectorCalls));
  }

  function cancelTimer() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  function setNotificationsEnabled(value) {
    notificationsEnabled = Boolean(value);
    return notificationsEnabled;
  }

  function stop() {
    unsubscribe();
    cancelTimer();
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
