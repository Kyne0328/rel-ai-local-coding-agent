import assert from 'node:assert/strict';
import { compareMetrics, parseArguments } from '../scripts/electron-package-size.mjs';

assert.deepEqual(parseArguments(['--dir', 'dist', '--platform', 'linux']), {
  distDir: 'dist',
  platform: 'linux',
  baselinePath: '',
  jsonPath: ''
});
assert.throws(() => parseArguments(['--strict']), /ordinary package-size drift is advisory/);

const baseline = { policy: 'advisory', tolerancePercent: 3, blockingGrowthPercent: 25, metrics: { installerBytes: 100 } };
const withinTolerance = compareMetrics({ installerBytes: 102 }, baseline)[0];
assert.equal(withinTolerance.exceedsTolerance, false);
assert.equal(withinTolerance.exceedsBlockingGrowth, false);

const ordinaryGrowth = compareMetrics({ installerBytes: 110 }, baseline)[0];
assert.equal(ordinaryGrowth.exceedsTolerance, true, 'normal package growth should be reported');
assert.equal(ordinaryGrowth.exceedsBlockingGrowth, false, 'normal package growth must not block a release');

const exceptionalGrowth = compareMetrics({ installerBytes: 130 }, baseline)[0];
assert.equal(exceptionalGrowth.exceedsTolerance, true);
assert.equal(exceptionalGrowth.exceedsBlockingGrowth, true, 'an exceptional jump remains a sanity guard for accidental payload growth');

console.log('Package-size policy reports ordinary growth and blocks only exceptional growth or structural packaging errors.');
