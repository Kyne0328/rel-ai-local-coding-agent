'use strict';

const { readConfig } = require('../config');
const { clearAuditHistory } = require('../audit');
const { readJsonBody, sendJson } = require('./io');

async function handleApiHistoryReset(ctx) {
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  if (payload.confirm !== true) {
    sendJson(ctx.res, 400, { ok: false, error: 'History reset requires confirm=true.' }, ctx.ae);
    return;
  }
  const activity = typeof ctx.options.getTaskActivity === 'function' ? ctx.options.getTaskActivity() : null;
  if (Number(activity?.activeCalls || 0) > 0) {
    sendJson(ctx.res, 409, { ok: false, error: 'Cannot clear session history while a Rel.AI tool call is running.' }, ctx.ae);
    return;
  }
  if (typeof ctx.options.resetTaskActivity === 'function') {
    const reset = ctx.options.resetTaskActivity();
    if (reset?.ok === false) {
      sendJson(ctx.res, 409, reset, ctx.ae);
      return;
    }
  }
  const cleared = clearAuditHistory(readConfig());
  sendJson(ctx.res, 200, {
    ok: true,
    message: 'Session and activity history cleared.',
    removedFiles: cleared.removedFiles,
    removedBytes: cleared.removedBytes
  }, ctx.ae);
}

module.exports = { handleApiHistoryReset };
