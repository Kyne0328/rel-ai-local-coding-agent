import assert from 'node:assert/strict';

import { approvalRequirement } from '../src/mcp/approval.js';
import {
  APPROVAL_TTL_MS,
  approvalDigest,
  requestApproval,
  supportsNativeApproval
} from '../src/mcp/approvalBroker.js';

const principal = { clientId: 'chatgpt-session-a', authMode: 'local_session' };
const otherPrincipal = { clientId: 'chatgpt-session-b', authMode: 'local_session' };
const baseArgs = {
  action: 'reset',
  workspace: 'repo',
  work_id: 'work-a',
  removeUntracked: true
};
const requirement = approvalRequirement('relai_changes', baseArgs);

assert.ok(requirement, 'destructive reset must still require approval');
assert.equal(approvalRequirement('relai_publish', {
  action: 'push', workspace: 'repo', work_id: 'work-a', remote: 'origin', branch: 'main', dryRun: false
}), null, 'real push must rely on publish authorization instead of a second approval interaction');
assert.equal(approvalRequirement('relai_publish', {
  action: 'push', workspace: 'repo', work_id: 'work-a', remote: 'origin', branch: 'main', dryRun: true
}), null, 'dry-run push must not require approval');
assert.equal(supportsNativeApproval({}), false);
assert.equal(supportsNativeApproval({ elicitation: {} }), true);
assert.equal(supportsNativeApproval({ elicitation: { form: {} } }), true);

assert.notEqual(approvalDigest('relai_changes', baseArgs), approvalDigest('relai_changes', { ...baseArgs, work_id: 'work-b' }));
assert.notEqual(approvalDigest('relai_changes', baseArgs), approvalDigest('relai_changes', { ...baseArgs, removeUntracked: false }));
assert.notEqual(approvalDigest('relai_changes', baseArgs), approvalDigest('relai_changes', { ...baseArgs, workspace: 'other' }));

const unsupportedCodec = fakeCodec();
const unsupported = await startApproval({ codec: unsupportedCodec, capabilities: {} });
assert.equal(unsupported.isError, true);
assert.equal(unsupported.structuredContent?.errorCode, 'APPROVAL_INTERACTION_UNAVAILABLE');
assert.equal(unsupported.structuredContent?.approvalRequired, true);
assert.equal(unsupported.structuredContent?.operation, 'reset');
assert.equal(unsupported.structuredContent?.workspace, 'repo');
assert.equal(unsupported.structuredContent?.work_id, 'work-a');
assert.equal(Object.hasOwn(unsupported.structuredContent || {}, 'approvalId'), false, 'unsupported clients must not create pending dashboard approvals');
assert.equal(Object.hasOwn(unsupported.structuredContent || {}, 'recovery'), false, 'unsupported clients must not advertise the removed dashboard approval fallback');
assert.match(unsupported.structuredContent?.nextAction || '', /client that supports MCP approval elicitation/i);

const nativeCodec = fakeCodec();
const native = await startApproval({ codec: nativeCodec, capabilities: { elicitation: {} } });
assert.equal(native.resultType, 'input_required');
assert.equal(nativeCodec.lastClaims.kind, 'relai_approval');
assert.equal(nativeCodec.lastClaims.workId, 'work-a');
assert.equal(nativeCodec.lastClaims.operation, 'reset');
assert.equal(Object.hasOwn(nativeCodec.lastClaims, 'push'), false, 'generic approval state must not carry obsolete push-target claims');

for (const [label, changedArgs, changedPrincipal] of [
  ['work_id', { work_id: 'work-b' }, principal],
  ['removeUntracked', { removeUntracked: false }, principal],
  ['workspace', { workspace: 'other' }, principal],
  ['principal', {}, otherPrincipal]
]) {
  const result = await requestApproval({
    name: 'relai_changes',
    args: { ...baseArgs, ...changedArgs },
    requirement,
    context: { principal: changedPrincipal, clientCapabilities: { elicitation: {} } },
    rawContext: rawContext({ inputResponses: accepted(true), state: nativeCodec.lastClaims }),
    codec: nativeCodec
  });
  assert.equal(result.structuredContent?.errorCode, label === 'principal' ? 'APPROVAL_PRINCIPAL_MISMATCH' : 'APPROVAL_TARGET_CHANGED', `${label} change must reject the approval`);
}

const expiryCodec = fakeCodec();
await startApproval({ codec: expiryCodec, capabilities: { elicitation: {} } });
const expiredState = { ...expiryCodec.lastClaims, expiresAt: Date.now() - 1 };
const expired = await requestApproval({
  name: 'relai_changes', args: baseArgs, requirement,
  context: { principal, clientCapabilities: { elicitation: {} } },
  rawContext: rawContext({ inputResponses: accepted(true), state: expiredState }),
  codec: expiryCodec
});
assert.equal(expired.structuredContent?.errorCode, 'APPROVAL_GRANT_EXPIRED');

const declineCodec = fakeCodec();
await startApproval({ codec: declineCodec, capabilities: { elicitation: {} } });
const declined = await requestApproval({
  name: 'relai_changes', args: baseArgs, requirement,
  context: { principal, clientCapabilities: { elicitation: {} } },
  rawContext: rawContext({ inputResponses: accepted(false), state: declineCodec.lastClaims }),
  codec: declineCodec
});
assert.equal(declined.structuredContent?.errorCode, 'APPROVAL_DECLINED');

const reuseCodec = fakeCodec();
await startApproval({ codec: reuseCodec, capabilities: { elicitation: {} } });
const approvedNative = await requestApproval({
  name: 'relai_changes', args: baseArgs, requirement,
  context: { principal, clientCapabilities: { elicitation: {} } },
  rawContext: rawContext({ inputResponses: accepted(true), state: reuseCodec.lastClaims }),
  codec: reuseCodec
});
assert.equal(approvedNative, null, 'accepted native approval must allow the original operation to continue');
const reusedNative = await requestApproval({
  name: 'relai_changes', args: baseArgs, requirement,
  context: { principal, clientCapabilities: { elicitation: {} } },
  rawContext: rawContext({ inputResponses: accepted(true), state: reuseCodec.lastClaims }),
  codec: reuseCodec
});
assert.equal(reusedNative.structuredContent?.errorCode, 'APPROVAL_GRANT_CONSUMED');

const timeoutCodec = fakeCodec();
await startApproval({ codec: timeoutCodec, capabilities: { elicitation: {} } });
const originalNow = Date.now;
Date.now = () => originalNow() + APPROVAL_TTL_MS + 1;
try {
  const expiredByClock = await requestApproval({
    name: 'relai_changes', args: baseArgs, requirement,
    context: { principal, clientCapabilities: { elicitation: {} } },
    rawContext: rawContext({ inputResponses: accepted(true), state: timeoutCodec.lastClaims }),
    codec: timeoutCodec
  });
  assert.equal(expiredByClock.structuredContent?.errorCode, 'APPROVAL_GRANT_EXPIRED');
} finally {
  Date.now = originalNow;
}

console.log('Approval broker destructive-operation elicitation, unsupported-client fail-closed behavior, expiry, replay, and principal isolation tests passed.');

async function startApproval({ codec, capabilities }) {
  return requestApproval({
    name: 'relai_changes',
    args: baseArgs,
    requirement,
    context: { principal, clientCapabilities: capabilities },
    rawContext: rawContext(),
    codec
  });
}

function accepted(approved) {
  return { approval: { action: 'accept', content: { approved } } };
}

function rawContext({ inputResponses, state } = {}) {
  return {
    mcpReq: {
      method: 'tools/call',
      inputResponses,
      requestState: () => state
    }
  };
}

function fakeCodec() {
  const claimsByGrant = new Map();
  return {
    lastClaims: null,
    async mint(claims) {
      const token = `grant-${claimsByGrant.size + 1}`;
      this.lastClaims = structuredClone(claims);
      claimsByGrant.set(token, structuredClone(claims));
      return token;
    },
    async verify(token) {
      const claims = claimsByGrant.get(token);
      if (!claims) throw new Error('Unknown grant');
      return structuredClone(claims);
    }
  };
}
