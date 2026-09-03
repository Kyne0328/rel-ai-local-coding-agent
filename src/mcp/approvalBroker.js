import * as crypto from 'node:crypto';
import { inputRequired, acceptedContent } from '@modelcontextprotocol/server';
import { resolveWorkspace } from '../config.js';
import { resolveGitPushTarget } from '../repo/gitOps.js';
import { principalFingerprint } from './principal.js';
import { toolResult } from './results.js';

const APPROVAL_TTL_MS = 5 * 60 * 1000;
const PENDING_APPROVALS = new Map();
const USED_APPROVAL_IDS = new Map();
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

  const approvalId = `approval_${crypto.randomBytes(18).toString('base64url')}`;
  PENDING_APPROVALS.set(approvalId, {
    id: approvalId,
    grant,
    claims,
    name,
    args: structuredClone(args || {}),
    requirement: { message: requirement.message },
    principal: principalFingerprint(context?.principal),
    originalPrincipal: context?.principal,
    createdAt: Date.now(),
    expiresAt,
    prepared
  });
  pruneApprovals();
  return toolResult({
    ok: false,
    errorCode: 'APPROVAL_INTERACTION_UNAVAILABLE',
    approvalRequired: true,
    operation: claims.operation || name,
    workspace: claims.workspace,
    work_id: claims.workId,
    ...(prepared.push || {}),
    approvalId,
    recovery: {
      mode: 'dashboard',
      dashboardPath: '/#tasks'
    },
    nextAction: 'Open the Rel.AI dashboard Tasks page to approve or cancel this operation.'
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

function readPendingApproval(approvalId, principal) {
  pruneApprovals();
  const pending = PENDING_APPROVALS.get(String(approvalId || ''));
  if (!pending || pending.expiresAt <= Date.now()) return null;
  if (principal && pending.principal !== principalFingerprint(principal)) return null;
  return pendingApprovalView(pending);
}

function listPendingApprovals() {
  pruneApprovals();
  return [...PENDING_APPROVALS.values()].map(pendingApprovalView);
}

async function decidePendingApproval({ approvalId, approved, context, rawContext, codec, config, execute }) {
  const id = String(approvalId || '');
  const pending = PENDING_APPROVALS.get(id);
  if (!pending) {
    pruneApprovals();
    return USED_APPROVAL_IDS.has(id)
      ? approvalReplayResult()
      : toolResult({ ok: false, errorCode: 'APPROVAL_NOT_FOUND', error: 'This approval is no longer available.' }, true);
  }
  if (pending.expiresAt <= Date.now()) {
    PENDING_APPROVALS.delete(id);
    return expiredApprovalResult();
  }
  pruneApprovals();
  if (pending.principal !== principalFingerprint(context?.principal)) {
    return toolResult({ ok: false, errorCode: 'APPROVAL_PRINCIPAL_MISMATCH', error: 'This approval belongs to a different client session.' }, true);
  }
  let claims;
  try { claims = await codec.verify(pending.grant, rawContext); }
  catch { return toolResult({ ok: false, errorCode: 'APPROVAL_GRANT_INVALID', error: 'This approval grant is invalid or expired.' }, true); }
  if (!claims || claims.nonce !== pending.claims.nonce || isNonceUsed(claims.nonce)) return approvalReplayResult();
  if (Date.now() > Number(claims.expiresAt || 0)) return expiredApprovalResult();
  const stale = await pendingStateMismatch(pending, config);
  if (stale) return stale;
  consumeApproval(pending, claims.expiresAt);
  if (approved !== true) return toolResult({ ok: false, cancelled: true, errorCode: 'APPROVAL_DECLINED', error: 'The user declined this operation.' }, true);
  return execute(pending.name, pending.args, context);
}

async function decidePendingApprovalFromDashboard({ approvalId, approved, config, codec, execute }) {
  const id = String(approvalId || '');
  const pending = PENDING_APPROVALS.get(id);
  if (!pending) {
    pruneApprovals();
    return USED_APPROVAL_IDS.has(id)
      ? approvalReplayResult().structuredContent
      : { ok: false, errorCode: 'APPROVAL_NOT_FOUND', error: 'This approval is no longer available.' };
  }
  if (pending.expiresAt <= Date.now()) {
    PENDING_APPROVALS.delete(id);
    return expiredApprovalResult().structuredContent;
  }
  pruneApprovals();
  if (isNonceUsed(pending.claims.nonce)) return approvalReplayResult().structuredContent;
  let claims;
  try {
    claims = await codec.verify(pending.grant, {
      mcpReq: { method: 'tools/call' },
      principal: pending.originalPrincipal
    });
  } catch {
    return { ok: false, errorCode: 'APPROVAL_GRANT_INVALID', error: 'This approval grant is invalid or expired.' };
  }
  if (!claims || claims.nonce !== pending.claims.nonce || claims.principal !== pending.principal) {
    return { ok: false, errorCode: 'APPROVAL_GRANT_INVALID', error: 'This approval grant does not match the pending operation.' };
  }
  if (Date.now() > Number(claims.expiresAt || 0)) return expiredApprovalResult().structuredContent;
  const stale = await pendingStateMismatch(pending, config);
  if (stale) return stale.structuredContent;
  consumeApproval(pending, claims.expiresAt);
  if (approved !== true) return { ok: false, cancelled: true, errorCode: 'APPROVAL_DECLINED', error: 'The user declined this operation.' };
  return execute(pending.name, pending.args, { principal: pending.originalPrincipal, publicHttpOnly: true });
}

async function pendingStateMismatch(pending, config) {
  if (pending.expiresAt <= Date.now()) return expiredApprovalResult();
  if (!pending.prepared?.push) return null;
  const workspace = resolveWorkspace(config, pending.args.workspace);
  const current = await resolveGitPushTarget(workspace, config, pending.args);
  return samePushTarget(pending.prepared.push, current) ? null : staleApprovalResult();
}

function pendingApprovalView(pending) {
  return {
    approvalId: pending.id,
    message: pending.requirement.message,
    tool: pending.name,
    operation: pending.claims.operation || pending.name,
    workspace: pending.claims.workspace,
    work_id: pending.claims.workId,
    ...(pending.prepared.push || {}),
    expiresAt: new Date(pending.expiresAt).toISOString()
  };
}

function consumeApproval(pending, expiresAt) {
  const deadline = Number(expiresAt || pending?.expiresAt || Date.now() + APPROVAL_TTL_MS);
  USED_APPROVAL_IDS.set(String(pending?.id || ''), deadline);
  USED_NONCES.set(String(pending?.claims?.nonce || ''), deadline);
  PENDING_APPROVALS.delete(pending.id);
}
function consumeNonce(nonce, expiresAt) {
  USED_NONCES.set(String(nonce), Number(expiresAt || Date.now() + APPROVAL_TTL_MS));
}
function isNonceUsed(nonce) { pruneApprovals(); return USED_NONCES.has(String(nonce || '')); }
function pruneApprovals() {
  const now = Date.now();
  for (const [id, pending] of PENDING_APPROVALS) if (pending.expiresAt <= now) PENDING_APPROVALS.delete(id);
  for (const [id, expiresAt] of USED_APPROVAL_IDS) if (expiresAt <= now) USED_APPROVAL_IDS.delete(id);
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
  decidePendingApproval,
  decidePendingApprovalFromDashboard,
  listPendingApprovals,
  readPendingApproval,
  requestApproval,
  samePushTarget,
  supportsNativeApproval
};
