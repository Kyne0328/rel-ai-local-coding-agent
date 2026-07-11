'use strict';

let activeConnectorCalls = 0;
const listeners = new Set();

function beginConnectorToolCall(details = {}) {
  let finished = false;
  const startedAt = Date.now();
  activeConnectorCalls += 1;
  notify({
    phase: 'started',
    activeConnectorCalls,
    tool: String(details.tool || ''),
    workspace: String(details.workspace || '')
  });

  return (result = {}) => {
    if (finished) return;
    finished = true;
    activeConnectorCalls = Math.max(0, activeConnectorCalls - 1);
    notify({
      phase: 'finished',
      activeConnectorCalls,
      tool: String(details.tool || ''),
      workspace: String(details.workspace || ''),
      ok: result.ok !== false,
      error: String(result.error || ''),
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  };
}

function onToolActivity(listener) {
  if (typeof listener !== 'function') throw new TypeError('Tool activity listener must be a function.');
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getToolActivity() {
  return { activeConnectorCalls };
}

function notify(event) {
  const snapshot = Object.freeze({ ...event });
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) {
        console.error('[rel-ai-mcp] tool activity listener:', error);
      }
    }
  }
}

module.exports = {
  beginConnectorToolCall,
  onToolActivity,
  getToolActivity
};
