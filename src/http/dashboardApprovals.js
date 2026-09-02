import { readConfig } from '../config.js';
import { callTool } from '../tools.js';
import { createRelaiRequestStateCodec } from '../mcp/context.js';
import { decidePendingApprovalFromDashboard, listPendingApprovals } from '../mcp/approvalBroker.js';
import { readJsonBody, sendJson } from './io.js';

function handleApiApprovals(ctx) {
  sendJson(ctx.res, 200, { ok: true, approvals: listPendingApprovals() });
}

async function handleApiApprovalDecision(ctx) {
  const body = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  const approvalId = String(body?.approvalId || '').trim();
  if (!approvalId || typeof body?.approved !== 'boolean') {
    sendJson(ctx.res, 400, { ok: false, errorCode: 'REQUEST_INVALID', error: 'approvalId and approved are required.' });
    return;
  }
  const config = readConfig();
  const result = await decidePendingApprovalFromDashboard({
    approvalId,
    approved: body.approved,
    config,
    codec: createRelaiRequestStateCodec(config),
    execute: (name, args, context) => callTool(name, args, context)
  });
  sendJson(ctx.res, result.ok === false && result.cancelled !== true ? 409 : 200, result);
}

export { handleApiApprovalDecision, handleApiApprovals };
