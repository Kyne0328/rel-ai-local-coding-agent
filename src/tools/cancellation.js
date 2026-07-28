'use strict';

const { requestCurrentTaskCancellation, taskError } = require('../toolActivity');
const { readTaskHistorySession } = require('../taskHistoryStore');
const { sanitizeDisplayText } = require('../taskObservability');

function cancelTask(config, args = {}) {
  const taskId = String(args.task_id || args.taskId || '').trim();
  if (!taskId) throw taskError('TASK_ID_REQUIRED', 'task_id is required to cancel a logical task.');

  const session = readTaskHistorySession(config, taskId);
  if (session?.status === 'cancelled') {
    return {
      ok: true,
      taskId,
      task_id: taskId,
      status: 'cancelled',
      duplicate: true,
      endReason: session.endReason || 'explicit_cancellation',
      terminalReason: session.terminalReason || session.currentActivity || 'Task cancelled.',
      endedAt: session.endedAt || null,
      cancelledAt: session.cancelledAt || session.endedAt || null,
      progress: session.progress
    };
  }

  const cancellation = requestCurrentTaskCancellation({
    reason: sanitizeDisplayText(args.reason || 'Task cancelled by request.', 500),
    initiator: 'connector_client'
  });
  return {
    ok: true,
    taskId: cancellation.taskId,
    task_id: cancellation.taskId,
    status: cancellation.status,
    duplicate: cancellation.duplicate,
    endReason: cancellation.endReason,
    terminalReason: cancellation.terminalReason,
    endedAt: cancellation.endedAt,
    cancelledAt: cancellation.cancelledAt,
    progress: cancellation.progress
  };
}

module.exports = { cancelTask };
