import assert from 'node:assert/strict';

import { supportPolicyView } from '../src/ui/features/settings/desktop-updates.js';

assert.equal(supportPolicyView({ state: 'current', currentVersion: '0.25.0', minimumSupportedVersion: '0.25.0' }).label, 'Supported');
assert.equal(supportPolicyView({ state: 'required', currentVersion: '0.24.9', minimumSupportedVersion: '0.25.0' }).tone, 'bad');
assert.match(supportPolicyView({ state: 'required', currentVersion: '0.24.9', minimumSupportedVersion: '0.25.0' }).description, /v0\.25\.0/);
assert.match(supportPolicyView({ state: 'deprecated', currentVersion: '0.24.9', minimumSupportedVersion: '0.25.0', enforceAfter: '2026-09-01T00:00:00.000Z' }).description, /2026|September|Sep/);
assert.match(supportPolicyView({ state: 'unavailable' }).description, /does not block|fail/i);

console.log('Desktop update support policy view tests passed.');
