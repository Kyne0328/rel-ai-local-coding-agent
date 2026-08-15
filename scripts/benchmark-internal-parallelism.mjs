import { performance } from 'node:perf_hooks';

const scenarios = Object.freeze([
  { name: 'search-fanout', jobs: 5, delayMs: 40 },
  { name: 'validation-fanout', jobs: 3, delayMs: 100 },
  { name: 'edit-post-actions', jobs: 2, delayMs: 80 }
]);

function sleep(delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

async function timedStep(delayMs) {
  const started = performance.now();
  await sleep(delayMs);
  return performance.now() - started;
}

async function runSerial({ jobs, delayMs }) {
  const started = performance.now();
  const stepDurationsMs = [];
  for (let index = 0; index < jobs; index += 1) {
    stepDurationsMs.push(await timedStep(delayMs));
  }
  return summarize(performance.now() - started, stepDurationsMs);
}

async function runParallel({ jobs, delayMs }) {
  const started = performance.now();
  const stepDurationsMs = await Promise.all(
    Array.from({ length: jobs }, () => timedStep(delayMs))
  );
  return summarize(performance.now() - started, stepDurationsMs);
}

function summarize(wallMs, stepDurationsMs) {
  return {
    wallMs: round(wallMs),
    accumulatedStepMs: round(stepDurationsMs.reduce((sum, value) => sum + value, 0)),
    stepDurationsMs: stepDurationsMs.map(round)
  };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

async function benchmarkScenario(scenario) {
  const serial = await runSerial(scenario);
  const parallel = await runParallel(scenario);
  return {
    ...scenario,
    serial,
    parallel,
    wallTimeSavedMs: round(serial.wallMs - parallel.wallMs),
    speedup: round(serial.wallMs / Math.max(1, parallel.wallMs))
  };
}

const results = [];
for (const scenario of scenarios) results.push(await benchmarkScenario(scenario));

const payload = {
  benchmark: 'internal-parallelism',
  purpose: 'Measure the wall-clock opportunity available when one ChatGPT Web MCP call fans independent work out internally.',
  scenarios: results
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  console.log('Internal parallelism benchmark');
  console.log('ChatGPT Web target: one MCP call -> internal fan-out -> one result.');
  for (const result of results) {
    console.log(`${result.name}: serial ${result.serial.wallMs} ms, parallel ${result.parallel.wallMs} ms, saved ${result.wallTimeSavedMs} ms (${result.speedup}x)`);
  }
}
