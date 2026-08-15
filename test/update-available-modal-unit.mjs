import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { supportPolicyModalView } from '../src/ui/update-available-modal.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src', 'ui', 'update-available-modal.js'), 'utf8');

const recommendedPolicy = { state: 'recommended', currentVersion: '0.25.0', minimumRecommendedVersion: '0.26.0', minimumSupportedVersion: '0.25.0', canContinue: true };
const deprecatedPolicy = { state: 'deprecated', currentVersion: '0.24.9', minimumRecommendedVersion: '0.25.0', minimumSupportedVersion: '0.25.0', enforceAfter: '2026-09-01T00:00:00.000Z', canContinue: true };
const requiredPolicy = { ...deprecatedPolicy, state: 'required', canContinue: false, requiresUpdate: true };
const emergencyPolicy = { ...requiredPolicy, state: 'emergency_blocked' };

assert.equal(supportPolicyModalView({ state: 'current' }), null);
assert.equal(supportPolicyModalView({ state: 'unavailable' }), null);
assert.equal(supportPolicyModalView(recommendedPolicy), null, 'recommended updates should stay passive instead of opening a modal');
assert.equal(supportPolicyModalView(deprecatedPolicy).allowLater, true);
assert.match(supportPolicyModalView(deprecatedPolicy).description, /September|2026|before/i);
assert.equal(supportPolicyModalView(requiredPolicy).blocking, true);
assert.equal(supportPolicyModalView(requiredPolicy).allowLater, false);
assert.match(supportPolicyModalView(emergencyPolicy).title, /critical/i);

assert.doesNotMatch(source, /shouldShowUpdateModal|showUpdateModal|Ignore this version/, 'routine optional updates must not open a competing dashboard modal');
assert.doesNotMatch(source, /getNotificationPreferences|setNotificationPreferences/, 'support-policy modal must not depend on notification preferences');
assert.match(source, /supportPolicyModalView/, 'required and support-policy update notices must remain available');
assert.match(source, /closeModal\(\);[\s\S]*bridge\[method\]\(\)/, 'support-policy update actions must close the modal before starting the action');

console.log('Update support-policy modal interaction tests passed.');
