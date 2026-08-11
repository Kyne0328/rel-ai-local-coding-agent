import assert from 'node:assert/strict';
import fs from 'node:fs';

const reliability = fs.readFileSync('docs/WORKFLOW_RELIABILITY.md', 'utf8');
const observability = fs.readFileSync('docs/TASK_OBSERVABILITY.md', 'utf8');
const bridge = fs.readFileSync('src/localRepoBridge.js', 'utf8');

for (const label of ['docs-only', 'local bug fix', 'feature slice', 'investigation', 'risky release']) {
  assert.match(reliability.toLowerCase(), new RegExp(label.replace('-', '[- ]')), `workflow reliability must document the ${label} shortest path`);
}
assert.match(reliability, /workflow\.recommendedActions/);
assert.match(reliability, /normalized command/i);
assert.match(reliability, /package-relative.*cwd/i);
assert.match(reliability, /current repository fingerprint/i);
assert.match(reliability, /nested package/i);
assert.doesNotMatch(reliability, /runChecks:\s*true/i);
assert.doesNotMatch(reliability, /one final broad verification|final broad verification/i);

assert.match(observability, /inactive.*non-terminal|non-terminal.*inactive/is);
assert.match(observability, /same [`']?work_id[`']?/i);
assert.match(observability, /resum/i);
assert.match(observability, /workflow.*stage/i);
assert.match(observability, /raw evidence.*not|not.*raw evidence/i);
assert.doesNotMatch(observability, /inactive sessions as `cancelled`|closes inactive sessions as cancelled/i);

assert.doesNotMatch(bridge, /relai_edit \{ runChecks: true/);
assert.doesNotMatch(bridge, /On final validation use relai_validate/);

console.log('Workflow documentation freshness and wording tests passed.');