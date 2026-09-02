import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { resolveWorkspace } from '../src/config.js';
import { approvalRequirement } from '../src/mcp/approval.js';
import {
  APPROVAL_TTL_MS,
  approvalDigest,
  decidePendingApproval,
  requestApproval,
  samePushTarget,
  supportsNativeApproval
} from '../src/mcp/approvalBroker.js';
import { relaiGitPush } from '../src/repo/gitOps.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-approval-broker-'));
const workspacePath = path.join(temp, 'workspace');
const remotePath = path.join(temp, 'remote.git');
fs.mkdirSync(workspacePath, { recursive: true });
git(workspacePath, 'init', '-b', 'main');
git(workspacePath, 'config', 'user.name', 'Rel.AI Approval Test');
git(workspacePath, 'config', 'user.email', 'approval-test@example.invalid');
fs.writeFileSync(path.join(workspacePath, 'tracked.txt'), 'initial\n');
git(workspacePath, 'add', '.');
git(workspacePath, 'commit', '-m', 'Initial');
git(temp, 'init', '--bare', remotePath);
git(workspacePath, 'remote', 'add', 'origin', remotePath);

const config = {
  version: 3,
  stateDir: path.join(temp, 'state'),
  workspaces: { repo: { path: workspacePath } }
};
const workspace = resolveWorkspace(config, 'repo');
const principal = { clientId: 'chatgpt-session-a', authMode: 'local_session' };
const otherPrincipal = { clientId: 'chatgpt-session-b', authMode: 'local_session' };
const baseArgs = {
  action: 'push',
  workspace: 'repo',
  work_id: 'work-a',
  remote: 'origin',
  branch: 'main',
  setUpstream: false
};
const requirement = { message: 'Publish branch main to origin?' };

try {
  assert.equal(supportsNativeApproval({}), false);
  assert.equal(supportsNativeApproval({ elicitation: {} }), true);
  assert.equal(supportsNativeApproval({ elicitation: { form: {} } }), true);
  assert.equal(approvalRequirement('relai_publish', { ...baseArgs, dryRun: true }), null, 'dry-run push must not require approval');
  assert.ok(approvalRequirement('relai_publish', { ...baseArgs, dryRun: false }), 'real push must require approval');

  const target = currentTarget();
  assert.equal(samePushTarget(target, { ...target }), true);
  for (const changed of [
    { branch: 'release' },
    { remote: 'upstream' },
    { head: '0'.repeat(40) },
    { workspace: 'other' },
    { setUpstream: true }
  ]) assert.equal(samePushTarget(target, { ...target, ...changed }), false);
  assert.notEqual(approvalDigest('relai_publish', baseArgs), approvalDigest('relai_publish', { ...baseArgs, work_id: 'work-b' }));
  assert.notEqual(approvalDigest('relai_publish', baseArgs), approvalDigest('relai_publish', { ...baseArgs, branch: 'release' }));
  assert.notEqual(approvalDigest('relai_publish', baseArgs), approvalDigest('relai_publish', { ...baseArgs, remote: 'upstream' }));

  const unsupportedCodec = fakeCodec();
  const unsupported = await startApproval({ codec: unsupportedCodec, capabilities: {} });
  assert.equal(unsupported.isError, true);
  assert.equal(unsupported.structuredContent?.errorCode, 'APPROVAL_INTERACTION_UNAVAILABLE');
  assert.equal(unsupported.structuredContent?.approvalRequired, true);
  assert.equal(unsupported.structuredContent?.remote, 'origin');
  assert.equal(unsupported.structuredContent?.branch, 'main');
  assert.equal(unsupported.structuredContent?.head, target.head);
  assert.equal(unsupported.structuredContent?.recovery?.renderTool, 'relai_approval');
  assert.match(unsupported.structuredContent?.approvalId || '', /^approval_/);

  let executed = 0;
  const declined = await decidePendingApproval({
    approvalId: unsupported.structuredContent.approvalId,
    approved: false,
    context: { principal },
    rawContext: rawContext(),
    codec: unsupportedCodec,
    config,
    execute: async () => { executed += 1; return { ok: true }; }
  });
  assert.equal(declined.structuredContent?.errorCode, 'APPROVAL_DECLINED');
  assert.equal(executed, 0, 'declining must not execute the stored operation');
  const declinedReuse = await decidePendingApproval({
    approvalId: unsupported.structuredContent.approvalId,
    approved: true,
    context: { principal }, rawContext: rawContext(), codec: unsupportedCodec, config,
    execute: async () => { executed += 1; return { ok: true }; }
  });
  assert.equal(declinedReuse.structuredContent?.errorCode, 'APPROVAL_GRANT_CONSUMED');
  assert.equal(executed, 0);

  const principalCodec = fakeCodec();
  const principalPending = await startApproval({ codec: principalCodec, capabilities: {} });
  const principalMismatch = await decidePendingApproval({
    approvalId: principalPending.structuredContent.approvalId,
    approved: true,
    context: { principal: otherPrincipal }, rawContext: rawContext(), codec: principalCodec, config,
    execute: async () => { executed += 1; return { ok: true }; }
  });
  assert.equal(principalMismatch.structuredContent?.errorCode, 'APPROVAL_PRINCIPAL_MISMATCH');
  assert.equal(executed, 0);

  const staleCodec = fakeCodec();
  const stalePending = await startApproval({ codec: staleCodec, capabilities: {} });
  fs.writeFileSync(path.join(workspacePath, 'tracked.txt'), 'changed after approval\n');
  git(workspacePath, 'add', 'tracked.txt');
  git(workspacePath, 'commit', '-m', 'Change HEAD after approval');
  const stale = await decidePendingApproval({
    approvalId: stalePending.structuredContent.approvalId,
    approved: true,
    context: { principal }, rawContext: rawContext(), codec: staleCodec, config,
    execute: async () => { executed += 1; return { ok: true }; }
  });
  assert.equal(stale.structuredContent?.errorCode, 'APPROVAL_TARGET_CHANGED');
  assert.equal(executed, 0, 'changed HEAD must reject before execution');

  const nativeCodec = fakeCodec();
  const native = await startApproval({ codec: nativeCodec, capabilities: { elicitation: {} } });
  assert.equal(native.resultType, 'input_required');
  assert.equal(nativeCodec.lastClaims.kind, 'relai_approval');
  assert.equal(nativeCodec.lastClaims.workId, 'work-a');
  assert.equal(nativeCodec.lastClaims.push.head, currentTarget().head);

  for (const [label, changedArgs, changedPrincipal] of [
    ['work_id', { work_id: 'work-b' }, principal],
    ['branch', { branch: 'release' }, principal],
    ['remote', { remote: 'upstream' }, principal],
    ['principal', {}, otherPrincipal]
  ]) {
    const result = await requestApproval({
      name: 'relai_publish',
      args: { ...baseArgs, ...changedArgs },
      requirement,
      context: { principal: changedPrincipal, clientCapabilities: { elicitation: {} } },
      rawContext: rawContext({ inputResponses: accepted(true), state: nativeCodec.lastClaims }),
      codec: nativeCodec,
      config
    });
    assert.equal(result.structuredContent?.errorCode, label === 'principal' ? 'APPROVAL_PRINCIPAL_MISMATCH' : 'APPROVAL_TARGET_CHANGED', `${label} change must reject the approval`);
  }

  const expiredState = { ...nativeCodec.lastClaims, expiresAt: Date.now() - 1 };
  const expired = await requestApproval({
    name: 'relai_publish', args: baseArgs, requirement,
    context: { principal, clientCapabilities: { elicitation: {} } },
    rawContext: rawContext({ inputResponses: accepted(true), state: expiredState }),
    codec: nativeCodec, config
  });
  assert.equal(expired.structuredContent?.errorCode, 'APPROVAL_GRANT_EXPIRED');

  const reuseCodec = fakeCodec();
  await startApproval({ codec: reuseCodec, capabilities: { elicitation: {} } });
  const approvedNative = await requestApproval({
    name: 'relai_publish', args: baseArgs, requirement,
    context: { principal, clientCapabilities: { elicitation: {} } },
    rawContext: rawContext({ inputResponses: accepted(true), state: reuseCodec.lastClaims }),
    codec: reuseCodec, config
  });
  assert.equal(approvedNative, null, 'accepted native approval must allow the original operation to continue');
  const reusedNative = await requestApproval({
    name: 'relai_publish', args: baseArgs, requirement,
    context: { principal, clientCapabilities: { elicitation: {} } },
    rawContext: rawContext({ inputResponses: accepted(true), state: reuseCodec.lastClaims }),
    codec: reuseCodec, config
  });
  assert.equal(reusedNative.structuredContent?.errorCode, 'APPROVAL_GRANT_CONSUMED');

  const pushCodec = fakeCodec();
  const pushPending = await startApproval({ codec: pushCodec, capabilities: {} });
  const approvedHead = pushPending.structuredContent.head;
  const pushed = await decidePendingApproval({
    approvalId: pushPending.structuredContent.approvalId,
    approved: true,
    context: { principal }, rawContext: rawContext(), codec: pushCodec, config,
    execute: async (_name, args) => relaiGitPush(workspace, config, args)
  });
  assert.equal(pushed.ok, true, JSON.stringify(pushed));
  assert.equal(git(remotePath, 'rev-parse', 'refs/heads/main'), approvedHead, 'approved exact HEAD must be the commit published to origin/main');
  const pushedReuse = await decidePendingApproval({
    approvalId: pushPending.structuredContent.approvalId,
    approved: true,
    context: { principal }, rawContext: rawContext(), codec: pushCodec, config,
    execute: async () => { executed += 1; return { ok: true }; }
  });
  assert.equal(pushedReuse.structuredContent?.errorCode, 'APPROVAL_GRANT_CONSUMED');
  assert.equal(executed, 0);

  const expiryCodec = fakeCodec();
  const expiryPending = await startApproval({ codec: expiryCodec, capabilities: {} });
  const originalNow = Date.now;
  Date.now = () => originalNow() + APPROVAL_TTL_MS + 1;
  try {
    const expiredPending = await decidePendingApproval({
      approvalId: expiryPending.structuredContent.approvalId,
      approved: true,
      context: { principal }, rawContext: rawContext(), codec: expiryCodec, config,
      execute: async () => { executed += 1; return { ok: true }; }
    });
    assert.equal(expiredPending.structuredContent?.errorCode, 'APPROVAL_GRANT_EXPIRED');
    assert.equal(executed, 0);
  } finally {
    Date.now = originalNow;
  }

  console.log('Approval broker transport fallback, exact push binding, expiry, replay, principal isolation, and real push tests passed.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

async function startApproval({ codec, capabilities }) {
  return requestApproval({
    name: 'relai_publish',
    args: baseArgs,
    requirement,
    context: { principal, clientCapabilities: capabilities },
    rawContext: rawContext(),
    codec,
    config
  });
}

function currentTarget() {
  return {
    workspace: 'repo',
    remote: 'origin',
    branch: 'main',
    head: git(workspacePath, 'rev-parse', 'HEAD'),
    setUpstream: false
  };
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

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
