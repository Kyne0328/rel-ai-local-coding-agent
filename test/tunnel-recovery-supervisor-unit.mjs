import assert from 'node:assert/strict';
import { createTunnelRecoverySupervisor } from '../electron/tunnel-recovery-supervisor.js';

let clock = 1000;
let restartCalls = 0;
const timers = [];
const schedules = [];
const restartResults = [
  { serverRunning: true, tunnelStatus: 'degraded', errorCode: 'tunnel_connection_interrupted', error: 'still offline' },
  { serverRunning: true, tunnelStatus: 'running', errorCode: '', error: '' }
];

const supervisor = createTunnelRecoverySupervisor({
  restartConnection: async () => {
    restartCalls += 1;
    return restartResults.shift();
  },
  retryDelaysMs: [10, 20, 30],
  now: () => clock,
  setTimer(fn, delayMs) {
    const timer = { fn, delayMs, cancelled: false };
    timers.push(timer);
    return timer;
  },
  clearTimer(timer) { timer.cancelled = true; },
  onSchedule: state => schedules.push(state)
});

const first = supervisor.observe({ state: 'failed', errorCode: 'secure_tunnel_failed', error: 'tunnel-client exited' });
assert.equal(first.scheduled, true, 'unexpected tunnel failure must schedule automatic recovery');
assert.equal(first.attempt, 1);
assert.equal(first.nextRetryAt, 1010);
assert.equal(timers[0].delayMs, 10);
assert.equal(schedules[0].lastError, 'tunnel-client exited');

await fireTimer(timers[0]);
assert.equal(restartCalls, 1, 'scheduled recovery must use the canonical connection retry operation');
assert.equal(supervisor.snapshot().scheduled, true, 'a retryable failed reconnect must schedule another attempt');
assert.equal(supervisor.snapshot().attempt, 2);
assert.equal(timers[1].delayMs, 20);

clock = 1030;
await fireTimer(timers[1]);
assert.equal(restartCalls, 2);
assert.equal(supervisor.snapshot().attempt, 0, 'successful reconnect must reset retry backoff');
assert.equal(supervisor.snapshot().scheduled, false);

const timerCountBeforeFatal = timers.length;
supervisor.observe({ state: 'failed', errorCode: 'tunnel_authentication_failed', error: 'rejected key' });
assert.equal(timers.length, timerCountBeforeFatal, 'authentication failures must remain terminal and must not retry');

supervisor.observe({ state: 'failed', errorCode: 'secure_tunnel_failed', error: 'offline again' });
const scheduledBeforeManualRetry = timers.at(-1);
restartResults.push({ serverRunning: true, tunnelStatus: 'running', errorCode: '', error: '' });
await supervisor.retryNow();
assert.equal(scheduledBeforeManualRetry.cancelled, true, 'Retry now must replace any pending automatic retry');
assert.equal(restartCalls, 3);
assert.equal(supervisor.snapshot().scheduled, false);

supervisor.observe({ state: 'failed', errorCode: 'secure_tunnel_failed', error: 'shutdown race' });
const cancelledOnStop = timers.at(-1);
supervisor.cancel();
assert.equal(cancelledOnStop.cancelled, true, 'shutdown must cancel a pending reconnect');
assert.equal(supervisor.snapshot().attempt, 0);

console.log('Secure tunnel recovery supervisor retries transient failures and stops on terminal failures.');

async function fireTimer(timer) {
  assert.equal(timer.cancelled, false, 'test attempted to fire a cancelled timer');
  timer.fn();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}
