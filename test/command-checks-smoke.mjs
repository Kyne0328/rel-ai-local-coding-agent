import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { relaiVerify } = require('../src/localRepoBridge.js');
const { mapCheckArgs } = (() => {
  // mapCheckArgs is not exported from localRepoBridge; replicate it here as the internal bridge does
  return {
    mapCheckArgs(args = {}) {
      return {
        ...args,
        command: args.command || args.check,
        commands: args.commands || args.checks,
        commandsText: args.commandsText || args.checksText
      };
    }
  };
})();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-checks-smoke-'));
const workspace = { path: tmp, alias: 'test', commands: { lint: 'echo lint ok' }, testCommands: {} };
const config = {};

// 1. Configured check by key — call relaiVerify with explicit check key mapped from commands
{
  const args = mapCheckArgs({ check: workspace.commands.lint });
  const result = await relaiVerify(workspace, config, args);
  assert.equal(result.ok, true, 'configured check by key should succeed');
  assert.ok(result.checks.includes('echo lint ok'), 'checks should include the configured command');
  assert.ok(result.results[0].stdout.includes('lint ok'), 'stdout should contain lint ok');
}

// 2. Ad-hoc check via check field
{
  const result = await relaiVerify(workspace, config, mapCheckArgs({ check: 'echo hello' }));
  assert.equal(result.ok, true, 'ad-hoc check should succeed');
  assert.ok(result.results[0].stdout.includes('hello'), 'stdout should contain hello');
}

// 3. checksText multi-line
{
  const result = await relaiVerify(workspace, config, mapCheckArgs({ checksText: 'echo line1\necho line2' }));
  assert.equal(result.ok, true, 'checksText multi-line should succeed');
  assert.equal(result.results.length, 2, 'should run 2 checks from checksText');
  assert.ok(result.results[0].stdout.includes('line1'), 'first check stdout should include line1');
  assert.ok(result.results[1].stdout.includes('line2'), 'second check stdout should include line2');
}

// 4. checks array
{
  const result = await relaiVerify(workspace, config, mapCheckArgs({ checks: ['echo a', 'echo b'] }));
  assert.equal(result.ok, true, 'checks array should succeed');
  assert.equal(result.results.length, 2, 'should run 2 checks from array');
  assert.ok(result.results[0].stdout.includes('a'), 'first array check stdout should contain a');
  assert.ok(result.results[1].stdout.includes('b'), 'second array check stdout should contain b');
}

// 5. Failing check returns structured failure with ok: false
{
  const result = await relaiVerify(workspace, config, mapCheckArgs({ check: 'node -e "process.exit(1)"' }));
  assert.equal(result.ok, false, 'failing check should return ok: false');
  assert.equal(result.results[0].ok, false, 'result entry should have ok: false');
  assert.notEqual(result.results[0].exitCode, 0, 'exitCode should be non-zero');
}

// 6. Timeout returns structured timeout result (very short timeout)
{
  // Use a sleep-like command: node -e with a long-running loop
  const sleepCmd = process.platform === 'win32'
    ? 'node -e "setTimeout(()=>{},30000)"'
    : 'node -e "setTimeout(()=>{},30000)"';
  const result = await relaiVerify(workspace, config, mapCheckArgs({ check: sleepCmd, timeoutMs: 50 }));
  assert.equal(result.ok, false, 'timeout should return ok: false');
  assert.ok(
    result.results[0].error || result.results[0].exitCode === -1,
    'timeout result should have error field or exitCode -1'
  );
}

// 7. Large output is truncated safely
{
  const largeCmd = 'node -e "process.stdout.write(\'x\'.repeat(5000000))"';
  const smallConfig = { maxOutputBytes: 100 * 1024 }; // 100 KB limit to ensure truncation
  const result = await relaiVerify(workspace, smallConfig, mapCheckArgs({ check: largeCmd, timeoutMs: 30000 }));
  // Should not throw; result should be an object with results array
  assert.ok(result && Array.isArray(result.results), 'large output result should have results array');
  const resultEntry = result.results[0];
  const stdout = resultEntry.stdout || '';
  const totalBytes = Buffer.byteLength(stdout, 'utf8');
  // Output should be capped — well below 5 MB
  assert.ok(totalBytes < 2 * 1024 * 1024, `output should be truncated, got ${totalBytes} bytes`);
}

// 8. Old command alias still maps internally (passes command: "echo aliased" and gets ok result)
{
  // mapCheckArgs maps command -> command (already is command), so we pass through as-is
  const args = mapCheckArgs({ command: 'echo aliased' });
  assert.equal(args.command, 'echo aliased', 'mapCheckArgs should keep command alias');
  const result = await relaiVerify(workspace, config, args);
  assert.equal(result.ok, true, 'command alias should work and produce ok result');
  assert.ok(result.results[0].stdout.includes('aliased'), 'stdout should include aliased');
}

// 9. run_checks bounds each command to a TAIL so the failing end survives the
//    server-level result cap; fullOutput keeps a larger tail.
{
  const cmd = 'node -e "process.stdout.write(\'a\'.repeat(50000)+\'END_MARKER_Z\')"';
  const result = await relaiVerify(workspace, config, mapCheckArgs({ check: cmd, timeoutMs: 30000 }));
  const stdout = result.results[0].stdout || '';
  assert.ok(stdout.length <= 4000 + 120, `default tail should bound stdout near 4000, got ${stdout.length}`);
  assert.ok(stdout.includes('END_MARKER_Z'), 'tail must keep the END of output where failures/summaries live');
  assert.ok(/kept last 4000 of \d+ chars/.test(stdout), 'tail marker should note how much was dropped');

  const full = await relaiVerify(workspace, config, mapCheckArgs({ check: cmd, fullOutput: true, timeoutMs: 30000 }));
  const fullStdout = full.results[0].stdout || '';
  assert.ok(fullStdout.length > 4000, 'fullOutput should keep a larger tail');
  assert.ok(fullStdout.includes('END_MARKER_Z'), 'fullOutput tail must keep the END of output');
}

console.log('Check-command smoke tests passed.');
