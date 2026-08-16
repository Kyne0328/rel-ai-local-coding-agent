

import { readConfig } from "../config.js";
import { clearAuditHistory } from "../audit.js";
import { ERROR_CODES, errorPayload } from "../desktopUxContracts.js";
import { activeLogicalTaskCount } from '../taskState.js';
import { readJsonBody, sendJson } from "./io.js";

async function handleApiHistoryReset(ctx) {
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  if (payload.confirm !== true) {
    sendJson(ctx.res, 400, errorPayload(ERROR_CODES.REQUEST_INVALID, 'History reset requires confirm=true.'));
    return;
  }
  const activity = typeof ctx.options.getTaskActivity === 'function' ? ctx.options.getTaskActivity() : null;
  const activeTasks = activeLogicalTaskCount(activity || {});
  if (activeTasks > 0) {
    const noun = activeTasks === 1 ? 'task is' : 'tasks are';
    sendJson(ctx.res, 409, errorPayload(ERROR_CODES.STATE_RESET_FAILED, `Cannot clear session history while ${activeTasks} Rel.AI ${noun} still active.`));
    return;
  }
  if (typeof ctx.options.resetTaskActivity === 'function') {
    const reset = ctx.options.resetTaskActivity();
    if (reset?.ok === false) {
      sendJson(ctx.res, 409, errorPayload(ERROR_CODES.STATE_RESET_FAILED, reset.error || 'Session history could not be cleared.'));
      return;
    }
  }
  const cleared = await clearAuditHistory(readConfig());
  sendJson(ctx.res, 200, {
    ok: true,
    message: 'Session and activity history cleared.',
    removedFiles: cleared.removedFiles,
    removedBytes: cleared.removedBytes
  });
}

export { handleApiHistoryReset };
