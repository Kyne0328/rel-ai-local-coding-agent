'use strict';

import { requestCurrentTaskCancellation, taskError } from '../toolActivity.js';
import { readTaskHistorySession } from '../taskHistoryStore.js';
import { sanitizeDisplayText } from '../taskObservability.js';

function cancelTask(config, args = {}) {
  const taskId = String(args.work_id || '').trim();
  if (!taskId) throw taskError('TASK_ID_REQUIRED', 'work_id is required to cancel a work session.');

  const session = readTaskHistorySession(config, taskId);
  if (session?.status === 'cancelled') {
    return {
      ok: true,
      work_id: taskId,
      status: 'cancelled',
      duplicate: true,
      endReason: session.endReason || 'explicit_cancellation',
      terminalReason: session.terminalReason || session.currentActivity || 'Work session cancelled.',
      endedAt: session.endedAt || null,
      cancelledAt: session.cancelledAt || session.endedAt || null,
      progress: session.progress
    };
  }

  const cancellation = requestCurrentTaskCancellation({
    reason: sanitizeDisplayText(args.reason || 'Work session cancelled by request.', 500),
    initiator: 'connector_client'
  });
  return {
    ok: true,
    work_id: cancellation.taskId,
    status: cancellation.status,
    duplicate: cancellation.duplicate,
    endReason: cancellation.endReason,
    terminalReason: cancellation.terminalReason,
    endedAt: cancellation.endedAt,
    cancelledAt: cancellation.cancelledAt,
    progress: cancellation.progress
  };
}

export { cancelTask };
