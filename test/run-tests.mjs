// Runs every test/*.mjs as its own node process so new test files are picked up
// automatically — no hand-maintained npm-script chain to drift out of date.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const testDir = import.meta.dirname;
const root = path.resolve(testDir, '..');

// Not tests: the syntax checker runs via `npm run check`, and this file is the runner.
const NOT_TESTS = new Set(['check-js.mjs', 'run-tests.mjs']);

const files = fs.readdirSync(testDir)
  .filter((name) => name.endsWith('.mjs') && !NOT_TESTS.has(name))
  .sort();

const failures = [];
for (const name of files) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [path.join(testDir, name)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5 * 60 * 1000
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (res.status === 0) {
    console.log(`PASS ${name} (${seconds}s)`);
  } else {
    failures.push(name);
    console.error(`FAIL ${name} (${seconds}s)`);
    if (res.stdout) console.error(res.stdout.trim());
    if (res.stderr) console.error(res.stderr.trim());
  }
}

console.log(`\n${files.length - failures.length}/${files.length} test files passed.`);
if (failures.length) {
  console.error(`Failed: ${failures.join(', ')}`);
  process.exit(1);
}
