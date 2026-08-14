import assert from 'node:assert/strict';

import {
  downloadUpdateFromModal,
  shouldShowUpdateModal,
  supportPolicyModalView
} from '../src/ui/update-available-modal.js';

const preferences = {
  enabled: true,
  applicationUpdates: true,
  ignoredUpdateVersion: ''
};
const available = { state: 'available', availableVersion: '0.24.1' };

assert.equal(shouldShowUpdateModal(available, preferences, new Set()), true);
assert.equal(shouldShowUpdateModal(available, { ...preferences, enabled: false }, new Set()), false);
assert.equal(shouldShowUpdateModal(available, { ...preferences, applicationUpdates: false }, new Set()), false);
assert.equal(shouldShowUpdateModal(available, { ...preferences, ignoredUpdateVersion: '0.24.1' }, new Set()), false);
assert.equal(shouldShowUpdateModal(available, { ...preferences, ignoredUpdateVersion: '0.24.0' }, new Set()), true);
assert.equal(shouldShowUpdateModal(available, preferences, new Set(['0.24.1'])), false);
assert.equal(shouldShowUpdateModal({ state: 'downloaded', availableVersion: '0.24.1' }, preferences, new Set()), false);
assert.equal(shouldShowUpdateModal({ state: 'available', availableVersion: '' }, preferences, new Set()), false);
assert.equal(shouldShowUpdateModal(null, preferences, new Set()), false);

const recommendedPolicy = { state: 'recommended', currentVersion: '0.25.0', minimumRecommendedVersion: '0.26.0', minimumSupportedVersion: '0.25.0', canContinue: true };
const deprecatedPolicy = { state: 'deprecated', currentVersion: '0.24.9', minimumRecommendedVersion: '0.25.0', minimumSupportedVersion: '0.25.0', enforceAfter: '2026-09-01T00:00:00.000Z', canContinue: true };
const requiredPolicy = { ...deprecatedPolicy, state: 'required', canContinue: false, requiresUpdate: true };
const emergencyPolicy = { ...requiredPolicy, state: 'emergency_blocked' };
assert.equal(supportPolicyModalView({ state: 'current' }), null);
assert.equal(supportPolicyModalView({ state: 'unavailable' }), null);
assert.equal(supportPolicyModalView(recommendedPolicy).blocking, false);
assert.match(supportPolicyModalView(recommendedPolicy).title, /recommended/i);
assert.equal(supportPolicyModalView(deprecatedPolicy).allowLater, true);
assert.match(supportPolicyModalView(deprecatedPolicy).description, /September|2026|before/i);
assert.equal(supportPolicyModalView(requiredPolicy).blocking, true);
assert.equal(supportPolicyModalView(requiredPolicy).allowLater, false);
assert.match(supportPolicyModalView(emergencyPolicy).title, /critical/i);
assert.equal(shouldShowUpdateModal({ ...available, supportPolicy: deprecatedPolicy }, preferences, new Set()), false);

let resolveDownload;
let closed = 0;
const pending = downloadUpdateFromModal({
  downloadUpdate: () => new Promise(resolve => { resolveDownload = resolve; })
}, {
  close: () => { closed += 1; },
  notify: () => assert.fail('successful update should not notify an error')
});
assert.equal(closed, 1, 'update modal must close synchronously before the download finishes');
resolveDownload({ ok: true });
assert.equal((await pending).ok, true);

const errors = [];
const failed = await downloadUpdateFromModal({
  downloadUpdate: async () => ({ ok: false, error: 'network unavailable' })
}, {
  close: () => { closed += 1; },
  notify: message => errors.push(message)
});
assert.equal(closed, 2, 'failed update attempts still close the modal immediately');
assert.equal(failed.ok, false);
assert.deepEqual(errors, ['network unavailable']);

console.log('Update available modal eligibility and interaction tests passed.');
