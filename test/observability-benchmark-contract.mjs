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
assert.match(benchmark, /persistence_writes_per_100_tool_calls[\s\S]*coalesced async atomic history writes[\s\S]*10/, 'benchmark must enforce a bounded async task-history write budget');
assert.match(benchmark, /local_analytics_hot_path_1000_calls_ms/, 'benchmark must measure analytics work on the tool-call hot path');
assert.match(benchmark, /local_analytics_persistence_writes_per_1000_calls/, 'benchmark must verify local analytics persistence is coalesced');
for (const workload of ['quietFullRenders', 'quietClockNodeUpdates', 'progressFullRenders', 'sessionRowReplacementsDuringProgress', 'timelineRenderMs', 'logicalTaskSwitchMemoryDeltaBytes', 'hiddenTimerElapsedMs', 'reconnectMs']) {
  assert.ok(fixture.includes(workload), `Electron benchmark fixture must execute ${workload}`);
}

console.log('Observability benchmark requires executable Electron renderer metrics and fails incomplete runs.');
