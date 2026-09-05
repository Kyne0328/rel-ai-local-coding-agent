import * as crypto from 'node:crypto';
import { inputRequired, acceptedContent } from '@modelcontextprotocol/server';
import { resolveWorkspace } from '../config.js';
import { resolveGitPushTarget } from '../repo/gitOps.js';
import { principalFingerprint } from './principal.js';
import { toolResult } from './results.js';

const APPROVAL_TTL_MS = 5 * 60 * 1000;
const USED_NONCES = new Map();

function supportsNativeApproval(capabilities = {}) {
  const elicitation = capabilities?.elicitation;
  if (!elicitation || typeof elicitation !== 'object' || Array.isArray(elicitation)) return false;
  return Object.keys(elicitation).length === 0 || Boolean(elicitation.form);
}

async function requestApproval({ name, args, requirement, context, rawContext, codec, config }) {
  const response = acceptedContent(rawContext?.mcpReq?.inputResponses, 'approval');
  const state = rawContext?.mcpReq?.requestState?.();
  const digest = approvalDigest(name, args);
  if (response && state?.kind === 'relai_approval') {
    if (state.tool !== name || state.digest !== digest) return staleApprovalResult();
    if (isNonceUsed(state.nonce)) return approvalReplayResult();
    const stale = await approvalStateMismatch(state, name, args, config, context);
    if (stale) return stale;
    consumeNonce(state.nonce, state.expiresAt);
    if (response.approved === true) return null;
    return toolResult({ ok: false, cancelled: true, errorCode: 'APPROVAL_DECLINED', error: 'The user declined this operation.' }, true);
  }

  const prepared = await prepareApproval(name, args, requirement, config);
  const expiresAt = Date.now() + APPROVAL_TTL_MS;
  const nonce = crypto.randomUUID();
  const claims = {
    kind: 'relai_approval',
    tool: name,
    digest,
    nonce,
    expiresAt,
    principal: principalFingerprint(context?.principal),
    workId: String(args?.work_id || ''),
    workspace: String(args?.workspace || ''),
    operation: String(args?.action || ''),
    push: prepared.push || null
  };
  const grant = await codec.mint(claims, rawContext);

  if (supportsNativeApproval(context?.clientCapabilities)) {
    return inputRequired({
      inputRequests: {
        approval: inputRequired.elicit({
          message: requirement.message,
          requestedSchema: {
            type: 'object',
            required: ['approved'],
            additionalProperties: false,
            properties: { approved: { type: 'boolean', title: 'Approve operation' } }
          }
        })
      },
      requestState: grant
    });
  }

  return toolResult({
    ok: false,
    errorCode: 'APPROVAL_INTERACTION_UNAVAILABLE',
    approvalRequired: true,
    operation: claims.operation || name,
    workspace: claims.workspace,
    work_id: claims.workId,
    ...(prepared.push || {}),
    nextAction: 'This client cannot show the approval required for this operation. Use a client that supports MCP approval elicitation, then request the operation again.'
  }, true);
}

async function prepareApproval(name, args, requirement, config) {
  if (name !== 'relai_publish' || String(args?.action || '') !== 'push') {
    return { message: requirement.message };
  }
  const workspace = resolveWorkspace(config, args.workspace);
  const push = await resolveGitPushTarget(workspace, config, args);
  return { message: requirement.message, push };
}

async function approvalStateMismatch(state, name, args, config, context) {
  if (Date.now() > Number(state.expiresAt || 0)) return expiredApprovalResult();
  if (state.principal !== principalFingerprint(context?.principal)) return principalMismatchResult();
  if (name !== 'relai_publish' || String(args?.action || '') !== 'push' || !state.push) return null;
  const workspace = resolveWorkspace(config, args.workspace);
  const current = await resolveGitPushTarget(workspace, config, args);
  return samePushTarget(state.push, current) ? null : staleApprovalResult();
}

function samePushTarget(left = {}, right = {}) {
  return left.workspace === right.workspace
    && left.remote === right.remote
    && left.branch === right.branch
    && left.head === right.head
    && Boolean(left.setUpstream) === Boolean(right.setUpstream);
}

function consumeNonce(nonce, expiresAt) {
  USED_NONCES.set(String(nonce), Number(expiresAt || Date.now() + APPROVAL_TTL_MS));
}

function isNonceUsed(nonce) {
  pruneNonces();
  return USED_NONCES.has(String(nonce || ''));
}

function pruneNonces() {
  const now = Date.now();
  for (const [nonce, expiresAt] of USED_NONCES) if (expiresAt <= now) USED_NONCES.delete(nonce);
}

function approvalReplayResult() { return toolResult({ ok: false, errorCode: 'APPROVAL_GRANT_CONSUMED', error: 'This approval was already used.' }, true); }
function expiredApprovalResult() { return toolResult({ ok: false, errorCode: 'APPROVAL_GRANT_EXPIRED', error: 'This approval expired. Request the operation again.' }, true); }
function staleApprovalResult() { return toolResult({ ok: false, errorCode: 'APPROVAL_TARGET_CHANGED', error: 'The approved repository state changed. Request approval again.' }, true); }
function principalMismatchResult() { return toolResult({ ok: false, errorCode: 'APPROVAL_PRINCIPAL_MISMATCH', error: 'This approval belongs to a different client session.' }, true); }

function approvalDigest(name, args) {
  const safe = { ...(args || {}) };
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

export {
  APPROVAL_TTL_MS,
  approvalDigest,
  requestApproval,
  samePushTarget,
  supportsNativeApproval
};
