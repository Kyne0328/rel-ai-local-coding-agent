import assert from 'node:assert/strict';
import fs from 'node:fs';

const files = [
  'skills/rel-ai-workflow/SKILL.md',
  'skills/rel-ai-debugging/SKILL.md',
  'skills/rel-ai-investigation/SKILL.md',
  'skills/rel-ai-verification/SKILL.md',
  'skills/rel-ai-dev-process/SKILL.md',
  'skills/rel-ai-planning/SKILL.md'
];
const text = Object.fromEntries(files.map(file => [file, fs.readFileSync(file, 'utf8')]));
const workflow = text['skills/rel-ai-workflow/SKILL.md'];
assert.doesNotMatch(workflow, /^## Standard workflow$/m, 'routing skill must not present one mandatory numbered workflow');
assert.match(workflow, /agent chooses|agent.*next action/i, 'routing skill must leave next-action judgment with the agent');
for (const label of ['documentation', 'bugfix', 'feature', 'investigation', 'release']) {
  assert.match(workflow.toLowerCase(), new RegExp(label), `routing skill must include a shortest-path ${label} example`);
}
for (const [file, contents] of Object.entries(text)) {
  assert.doesNotMatch(contents, /workflow\.recommendedActions|workflow\.avoidActions|runtime workflow guidance/i, `${file} must not defer planning to a duplicate runtime workflow coach`);
  assert.doesNotMatch(contents, /runChecks:\s*true/i, `${file} must not universally prescribe runChecks:true`);
}
assert.match(text['skills/rel-ai-verification/SKILL.md'], /reuse.*fresh|fresh.*reuse/i, 'verification skill must avoid rerunning exact fresh evidence');
assert.match(text['skills/rel-ai-dev-process/SKILL.md'], /reused:\s*true|reused process/i, 'process skill must recognize exact same-task runtime reuse');

console.log('Evidence-driven built-in skill guidance tests passed.');
