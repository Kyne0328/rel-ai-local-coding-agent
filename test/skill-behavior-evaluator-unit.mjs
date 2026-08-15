import assert from 'node:assert/strict';
import fs from 'node:fs';

import { assertSkillBehavior, evaluateSkillBehavior } from '../scripts/evaluate-skill-behavior.mjs';

const expectations = JSON.parse(fs.readFileSync(new URL('./fixtures/skill-behavior-prompts.json', import.meta.url), 'utf8'));
const observations = expectations.map(item => ({
  id: item.id,
  prompt: item.prompt,
  skills: [...item.skills],
  firstTool: item.firstTool,
  firstAction: item.firstAction,
  tools: item.firstTool ? [item.firstTool] : []
}));

const passing = evaluateSkillBehavior(expectations, observations);
assert.equal(passing.ok, true);
assert.equal(passing.evaluated, expectations.length);
assert.equal(passing.failed, 0);
assert.doesNotThrow(() => assertSkillBehavior(passing));

const pressureIndex = expectations.findIndex(item => item.scenario === 'pressure');
const oneShotIndex = expectations.findIndex(item => item.forbiddenTool === 'relai_process');
const negativeIndex = expectations.findIndex(item => item.skills.length === 0);
assert.ok(pressureIndex >= 0 && oneShotIndex >= 0 && negativeIndex >= 0, 'fixture must include pressure, forbidden-tool, and negative cases');

const wrong = structuredClone(observations);
wrong[pressureIndex].skills = ['rel-ai-workflow', 'rel-ai-planning', 'rel-ai-debugging', 'rel-ai-investigation', 'rel-ai-verification', 'rel-ai-dev-process'];
wrong[oneShotIndex].tools.push('relai_process');
wrong[negativeIndex].skills = ['rel-ai-workflow'];
wrong[negativeIndex].firstTool = 'relai_work';
wrong[negativeIndex].firstAction = 'status';
wrong.pop();

const failing = evaluateSkillBehavior(expectations, wrong);
assert.equal(failing.ok, false);
assert.ok(failing.failures.some(item => item.kind === 'skills' && item.scenario === 'pressure'), 'over-invoking specialists must fail the eval');
assert.ok(failing.failures.some(item => item.kind === 'forbidden_tool'), 'using a managed process for one-shot work must fail the eval');
assert.ok(failing.failures.some(item => item.kind === 'first_tool'), 'repository tooling on a non-repository prompt must fail the eval');
assert.ok(failing.failures.some(item => item.kind === 'first_action'), 'wrong first relai_work action must fail the eval');
assert.ok(failing.failures.some(item => item.kind === 'missing_observation'), 'missing recorded cases must fail the eval');
assert.throws(() => assertSkillBehavior(failing), /Skill behavior evaluation failed/);

assert.throws(
  () => evaluateSkillBehavior([{ prompt: 'Repo task', skills: ['rel-ai-workflow'], firstTool: 'relai_work', firstAction: 'status' }], []),
  /must expect relai_work begin first/,
  'repository behavior expectations must encode the task-begin invariant'
);

console.log('Provider-agnostic skill behavior evaluator catches routing, first-action, forbidden-tool, and missing-case regressions.');
