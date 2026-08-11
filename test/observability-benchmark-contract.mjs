import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const benchmark = fs.readFileSync(path.join(root, 'scripts', 'observability-benchmark.mjs'), 'utf8');
const fixture = fs.readFileSync(path.join(root, 'test', 'fixtures', 'electron-observability-benchmark', 'index.js'), 'utf8');

assert.doesNotMatch(benchmark, /'blocked'.*Renderer benchmark|hardcoded/i);
assert.match(benchmark, /REL_AI_RENDERER_BENCHMARK_RESULT/);
assert.match(benchmark, /status:\s*'incomplete'|forcedStatus.*incomplete|incomplete/);
assert.match(benchmark, /process\.exitCode = 1/);
assert.match(benchmark, /runDashboardClockBenchmark/, 'benchmark must execute the production dashboard clock against a realistic session workload');
assert.match(benchmark, /const DASHBOARD_SNAPSHOT_COALESCE_MS = 100;/, 'benchmark publication simulation must match the dashboard 100 ms coalescer');
assert.match(benchmark, /quietClockNodeUpdates.*sessionRowReplacementsDuringProgress/, 'renderer result validation must require the new clock and keyed-session metrics');
for (const workload of ['quietFullRenders', 'quietClockNodeUpdates', 'progressFullRenders', 'sessionRowReplacementsDuringProgress', 'timelineRenderMs', 'logicalTaskSwitchMemoryDeltaBytes', 'hiddenTimerElapsedMs', 'reconnectMs']) {
  assert.ok(fixture.includes(workload), `Electron benchmark fixture must execute ${workload}`);
}

console.log('Observability benchmark requires executable Electron renderer metrics and fails incomplete runs.');
