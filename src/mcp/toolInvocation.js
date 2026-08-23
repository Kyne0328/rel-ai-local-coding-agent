import { requireApprovalIfNeeded } from './approval.js';
import { toolResult } from './results.js';
import { callTool } from '../tools.js';
import { serializeToolError } from '../tools/errors.js';
import { appUiResultMetadata } from './appUi.js';

async function invokeRelaiTool(options = {}) {
  const name = String(options.name || '');
  const args = options.args || {};
  try {
    if (options.approvalContext && options.requestStateCodec) {
      const approval = await requireApprovalIfNeeded(
        name,
        args,
        options.approvalContext,
        options.requestStateCodec
      );
      if (approval) return approval;
    }
    const output = await callTool(name, args, options.context || {});
    if (output?.ok !== false && typeof options.validateOutput === 'function') {
      await options.validateOutput(output);
    }
    return toolResult(output, output?.ok === false, appUiResultMetadata(name, options.context));
  } catch (error) {
    return toolResult(serializeToolError(name, error), true, appUiResultMetadata(name, options.context));
  }
}

export { invokeRelaiTool };
