import assert from 'node:assert/strict';

import { safeOrigin } from '../electron/dashboard-window-navigation.js';

const dashboardOrigin = 'http://127.0.0.1:3333';

assert.equal(
  safeOrigin(`${dashboardOrigin}/dashboard#activity`),
  dashboardOrigin,
  'the privileged dashboard document may navigate within its own route'
);
assert.equal(
  safeOrigin(`${dashboardOrigin}/api/settings`),
  '',
  'same-origin service routes must not be treated as privileged dashboard documents'
);
assert.equal(
  safeOrigin(`${dashboardOrigin}/dashboard/child`),
  '',
  'dashboard subpaths are separate documents and must not inherit the privileged preload surface'
);
assert.equal(
  safeOrigin('http://user:secret@127.0.0.1:3333/dashboard'),
  '',
  'credential-bearing URLs must not be accepted as privileged dashboard targets'
);
assert.equal(safeOrigin('https://example.com/dashboard'), 'https://example.com');

console.log('Dashboard privileged navigation is pinned to the canonical /dashboard document.');
