

import * as crypto from "node:crypto";
import { inputRequired, acceptedContent } from "@modelcontextprotocol/server";
import { toolResult } from "./results.js";

async function requireApprovalIfNeeded(name, args, context, codec) {
  const requirement = approvalRequirement(name, args);
  if (!requirement) return null;
  const response = acceptedContent(context.mcpReq.inputResponses, 'approval');
  const state = context.mcpReq.requestState();
  const expectedDigest = approvalDigest(name, args);
  if (response && state && state.tool === name && state.digest === expectedDigest) {
    if (response.approved === true) return null;
    return toolResult({ ok: false, cancelled: true, error: 'The user declined this operation.' }, true);
  }
  const requestState = await codec.mint({ tool: name, digest: expectedDigest, issuedAt: Date.now() }, context);
  return inputRequired({
    inputRequests: {
      approval: inputRequired.elicit({
        message: requirement.message,
        requestedSchema: {
          type: 'object',
          properties: { approved: { type: 'boolean', title: 'Approve operation' } },
          required: ['approved'],
          additionalProperties: false
        }
      })
    },
    requestState
  });
}

function approvalRequirement(name, args) {
  if (name === 'relai_reset_workspace') return { message: `Discard workspace changes using ${args.removeUntracked ? 'RESET_AND_CLEAN' : 'RESET'}?` };
  if (name === 'relai_worktree_remove') return { message: `Remove managed worktree ${args.alias || ''}${args.force ? ' with force' : ''}? The Git branch will be preserved.` };
  if (name === 'relai_git_push') return { message: `Publish branch ${args.branch || '(current branch)'} to ${args.remote || 'origin'}?` };
  if (name === 'relai_git_commit' && (args.addAll === true || args.sensitiveAuthorization)) return { message: `Create the requested Git commit${args.addAll ? ' including all current changes' : ''}?` };
  return null;
}

function approvalDigest(name, args) {
  const safe = { ...args };
  delete safe.task_id;
  delete safe.taskId;
  delete safe._deferredExecution;
  delete safe._operationTaskId;
  if (safe.sensitiveAuthorization) safe.sensitiveAuthorization = { ...safe.sensitiveAuthorization, reason: '[provided]' };
  return crypto.createHash('sha256').update(name).update('\0').update(stableJson(safe)).digest('base64url');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

export { requireApprovalIfNeeded, approvalRequirement, approvalDigest };
