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

function bindToolActivitySleep({ toolActivity, powerSaveBlocker, isReady = () => true }) {
  const blocker = createToolSleepBlocker(powerSaveBlocker);
  const unsubscribe = toolActivity.onToolActivity(({ activeConnectorCalls }) => {
    if (isReady()) blocker.update(activeConnectorCalls);
  });
  return () => {
    unsubscribe();
    blocker.stop();
  };
}

module.exports = { createToolSleepBlocker, bindToolActivitySleep };
