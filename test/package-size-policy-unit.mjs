import assert from 'node:assert/strict';
import { compareMetrics, parseArguments } from '../scripts/electron-package-size.mjs';

assert.deepEqual(parseArguments(['--dir', 'dist', '--platform', 'linux', '--strict']), {
  distDir: 'dist',
  platform: 'linux',
  baselinePath: '',
  jsonPath: '',
  strict: true
});
assert.throws(() => parseArguments(['--warn-only']), /removed/);

const withinBudget = compareMetrics(
  { installerBytes: 102 },
  { tolerancePercent: 3, metrics: { installerBytes: 100 } }
);
assert.equal(withinBudget[0].exceedsTolerance, false);

const overBudget = compareMetrics(
  { installerBytes: 104 },
  { tolerancePercent: 3, metrics: { installerBytes: 100 } }
);
assert.equal(overBudget[0].exceedsTolerance, true);
assert.ok(overBudget[0].deltaPercent > 3);

const gatewayRuntimeWithinBudget = compareMetrics(
  { appAsarBytes: 103, resourcesBytes: 206 },
  { tolerancePercent: 3, metrics: { appAsarBytes: 100, resourcesBytes: 200 } }
);
assert.deepEqual(gatewayRuntimeWithinBudget.map(item => item.exceedsTolerance), [false, false]);

const gatewayRuntimeOverBudget = compareMetrics(
  { appAsarBytes: 104, resourcesBytes: 208 },
  { tolerancePercent: 3, metrics: { appAsarBytes: 100, resourcesBytes: 200 } }
);
assert.deepEqual(gatewayRuntimeOverBudget.map(item => item.exceedsTolerance), [true, true]);

console.log('Package-size policy is strict and fails measurements above the documented tolerance.');
