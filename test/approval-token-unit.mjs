import assert from 'node:assert/strict';

import { createApprovalTokenManager } from "../electron/approval-token.js";

const currentConfig = {
  port: 3333,
  token: 'old-token',
  ngrokDomain: 'example.ngrok-free.dev',
  ngrokAuthtoken: 'ngrok-key',
  ngrokDownloadAccepted: true
};

function createHarness(options = {}) {
  const calls = [];
  const saved = [];
  let required = false;
  let saveCount = 0;
  const manager = createApprovalTokenManager({
    readGuiConfig: () => ({ ...currentConfig }),
    saveLauncherConfig: config => {
      saveCount += 1;
      calls.push(`save:${config.token}`);
      if (options.saveFailureAt === saveCount) throw new Error(options.saveError || 'disk full');
      saved.push({ ...config });
    },
    generateToken: bytes => {
      calls.push(`generate:${bytes}`);
      return 'new-token';
    },
    oauthProvider: {
      revokeAuthorizations: () => {
        calls.push('revoke');
        if (options.revokeFailure) throw new Error('revoke failed');
        required = true;
        return { authorizationCodes: 1, accessTokens: 2, refreshTokens: 3, registeredClientsPreserved: 4 };
      },
      authorizationStatus: () => ({ required, registeredClients: 4 })
    },
    restartDesktop: async () => {
      calls.push('restart');
      if (options.restartThrows) throw new Error('restart crashed');
      return options.restartFailure ? { serverRunning: false, error: 'restart failed' } : { serverRunning: true, tunnelStatus: 'running' };
    }
  });
  return { manager, calls, saved };
}

const confirmation = createHarness();
await assert.rejects(confirmation.manager.replace({ confirmation: 'replace' }), /Type REPLACE/);
assert.deepEqual(confirmation.calls, []);

const success = createHarness();
const result = await success.manager.replace({ confirmation: 'REPLACE' });
assert.deepEqual(success.calls, ['generate:32', 'save:new-token', 'revoke', 'restart']);
assert.equal(result.ok, true);
assert.equal(result.restartRequired, false);
assert.equal(result.approvalToken, 'new-token');
assert.equal(result.authorization.required, true);
assert.deepEqual(success.saved[0], { ...currentConfig, token: 'new-token' });

const saveFailure = createHarness({ saveFailureAt: 1 });
await assert.rejects(
  saveFailure.manager.replace({ confirmation: 'REPLACE' }),
  /not started.*current token and OAuth grants are unchanged.*disk full/i
);
assert.deepEqual(saveFailure.calls, ['generate:32', 'save:new-token']);

const revokeFailure = createHarness({ revokeFailure: true });
await assert.rejects(
  revokeFailure.manager.replace({ confirmation: 'REPLACE' }),
  /rolled back.*original token was restored/i
);
assert.deepEqual(revokeFailure.calls, ['generate:32', 'save:new-token', 'revoke', 'save:old-token']);
assert.equal(revokeFailure.saved.at(-1).token, 'old-token');

const rollbackFailure = createHarness({ revokeFailure: true, saveFailureAt: 2, saveError: 'rollback disk error' });
await assert.rejects(
  rollbackFailure.manager.replace({ confirmation: 'REPLACE' }),
  /original approval token could not be restored.*revoke failed.*rollback disk error/i
);

for (const options of [{ restartFailure: true }, { restartThrows: true }]) {
  const restartFailure = createHarness(options);
  const partial = await restartFailure.manager.replace({ confirmation: 'REPLACE' });
  assert.equal(partial.ok, false);
  assert.equal(partial.restartRequired, true);
  assert.equal(partial.approvalToken, 'new-token');
  assert.match(partial.error, /token was replaced.*did not restart/i);
}

console.log('Approval-token replacement unit tests passed.');
