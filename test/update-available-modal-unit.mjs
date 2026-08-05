import assert from 'node:assert/strict';

import { shouldShowUpdateModal } from '../src/ui/update-available-modal.js';

const preferences = {
  enabled: true,
  applicationUpdates: true,
  ignoredUpdateVersion: ''
};
const available = { state: 'available', availableVersion: '0.24.0' };

assert.equal(shouldShowUpdateModal(available, preferences, new Set()), true);
assert.equal(shouldShowUpdateModal(available, { ...preferences, enabled: false }, new Set()), false);
assert.equal(shouldShowUpdateModal(available, { ...preferences, applicationUpdates: false }, new Set()), false);
assert.equal(shouldShowUpdateModal(available, { ...preferences, ignoredUpdateVersion: '0.24.0' }, new Set()), false);
assert.equal(shouldShowUpdateModal(available, { ...preferences, ignoredUpdateVersion: '0.23.9' }, new Set()), true);
assert.equal(shouldShowUpdateModal(available, preferences, new Set(['0.24.0'])), false);
assert.equal(shouldShowUpdateModal({ state: 'downloaded', availableVersion: '0.24.0' }, preferences, new Set()), false);
assert.equal(shouldShowUpdateModal({ state: 'available', availableVersion: '' }, preferences, new Set()), false);
assert.equal(shouldShowUpdateModal(null, preferences, new Set()), false);

console.log('Update available modal eligibility tests passed.');
