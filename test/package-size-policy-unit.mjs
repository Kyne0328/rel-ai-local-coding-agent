import assert from 'node:assert/strict';
import { compareMetrics, parseArguments } from '../scripts/electron-package-size.mjs';

assert.deepEqual(parseArguments(['--dir', 'dist', '--platform', 'linux']), {
  distDir: 'dist',
  platform: 'linux',
  baselinePath: '',
  jsonPath: ''
});
assert.throws(() => parseArguments(['--strict']), /ordinary package-size drift is advisory/);

const baseline = {
  policy: 'advisory',
  tolerancePercent: 3,
  blockingGrowthPercent: 25,
  blockingMetrics: ['installerBytes'],
  metrics: { installerBytes: 100 }
};
const withinTolerance = compareMetrics({ installerBytes: 102 }, baseline)[0];
assert.equal(withinTolerance.exceedsTolerance, false);
assert.equal(withinTolerance.exceedsBlockingGrowth, false);

const ordinaryGrowth = compareMetrics({ installerBytes: 110 }, baseline)[0];
assert.equal(ordinaryGrowth.exceedsTolerance, true, 'normal package growth should be reported');
assert.equal(ordinaryGrowth.exceedsBlockingGrowth, false, 'normal package growth must not block a release');

const exceptionalGrowth = compareMetrics({ installerBytes: 130 }, baseline)[0];
assert.equal(exceptionalGrowth.exceedsTolerance, true);
assert.equal(exceptionalGrowth.exceedsBlockingGrowth, true, 'an exceptional jump remains a sanity guard for accidental payload growth');

const mixedBaseline = {
  policy: 'advisory',
  tolerancePercent: 5,
  blockingGrowthPercent: 25,
  blockingMetrics: ['appImageBytes', 'unpackedBytes', 'resourcesBytes'],
  metrics: {
    appImageBytes: 1000,
    unpackedBytes: 3000,
    resourcesBytes: 1500,
    appAsarBytes: 100,
    packagedDependencyBytes: 10
  }
};
const componentDrift = compareMetrics({
  appImageBytes: 1006,
  unpackedBytes: 3018,
  resourcesBytes: 1519,
  appAsarBytes: 128,
  packagedDependencyBytes: 34
}, mixedBaseline);
assert.equal(componentDrift.find(item => item.metric === 'appAsarBytes').deltaPercent.toFixed(2), '28.00');
assert.equal(componentDrift.find(item => item.metric === 'appAsarBytes').exceedsBlockingGrowth, false,
  'a small ASAR bucket crossing 25% must remain diagnostic when the release footprint is stable');
assert.equal(componentDrift.find(item => item.metric === 'packagedDependencyBytes').deltaPercent, 240);
assert.equal(componentDrift.find(item => item.metric === 'packagedDependencyBytes').exceedsBlockingGrowth, false,
  'a small dependency bucket can have a large relative percentage without becoming a release blocker');
assert.equal(componentDrift.some(item => item.exceedsBlockingGrowth), false,
  'component-only percentage drift must not fail a release whose aggregate footprint is stable');

const aggregateExplosion = compareMetrics({ ...mixedBaseline.metrics, appImageBytes: 1300 }, mixedBaseline)
  .find(item => item.metric === 'appImageBytes');
assert.equal(aggregateExplosion.blocksRelease, true);
assert.equal(aggregateExplosion.exceedsBlockingGrowth, true,
  'a 30% jump in an aggregate release artifact must still block release for investigation');

console.log('Package-size policy reports ordinary growth and blocks only exceptional growth or structural packaging errors.');
