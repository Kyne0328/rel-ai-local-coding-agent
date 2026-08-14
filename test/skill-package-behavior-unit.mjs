import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePlugin } from '../scripts/validate-plugin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = ['rel-ai-debugging', 'rel-ai-dev-process', 'rel-ai-investigation', 'rel-ai-planning', 'rel-ai-verification', 'rel-ai-workflow'];
const validation = validatePlugin(root);
assert.deepEqual(validation.skills, expected);

const workflow = read('skills/rel-ai-workflow/SKILL.md');
assert.match(descriptionOf(workflow), /inspect.*read.*edit.*test.*build.*debug.*validate.*review.*publish/i);
assert.match(descriptionOf(workflow), /Do not use.*no repository or local runtime access/i);
assert.match(workflow, /action: "begin"` exactly once/);
assert.match(workflow, /Tests, builds, linters, source checks, and release gates are one-shot commands/);
assert.match(workflow, /relai:\/\/server\/tool-surface/);
assert.match(workflow, /shortest sufficient path/i);
assert.match(workflow, /only work-session owner/i);
assert.match(workflow, /invoking every specialist.*anti-pattern/i);
assert.match(workflow, /continue through ordinary task boundaries/i);
assert.match(workflow, /update.*checkbox/i);
assert.match(workflow, /runtime policy remains authoritative/i);
assert.match(workflow, /\[references\/workflows\.md\]\(references\/workflows\.md\)/);
assert.match(workflow, /\[references\/safety\.md\]\(references\/safety\.md\).*destructive or approval-gated/i);

const planning = read('skills/rel-ai-planning/SKILL.md');
assert.match(descriptionOf(planning), /Do not use for small localized changes/i);
assert.match(planning, /Reuse the active `work_id`/);
assert.match(planning, /Do not call `relai_work` with `action: "begin"`/);
assert.match(planning, /Do not trigger for small localized changes/);
assert.match(planning, /explicit completion conditions/);
assert.match(planning, /cumulative consolidation/i);
assert.match(planning, /hand execution back to `rel-ai-workflow`/i);

for (const name of expected.filter(name => name !== 'rel-ai-workflow')) {
  const source = read(`skills/${name}/SKILL.md`);
  assert.match(source, /Reuse the active `work_id`/);
  assert.match(source, /Do not call `relai_work` with `action: "begin"`/);
}

const investigation = read('skills/rel-ai-investigation/SKILL.md');
assert.match(descriptionOf(investigation), /read-only repository questions/i);
assert.match(descriptionOf(investigation), /Do not use.*final completion or release verification/i);
assert.match(investigation, /bootstrap.*search\/inspect.*targeted reads.*bounded measurement.*broader reads only if required/i);
assert.match(investigation, /sufficient proof/i);
assert.match(investigation, /stop when.*proof/i);
assert.match(investigation, /This skill does not edit/i);

const debugging = read('skills/rel-ai-debugging/SKILL.md');
assert.match(descriptionOf(debugging), /causal diagnosis or repair/i);
assert.match(descriptionOf(debugging), /Do not use for general audits or final verification/i);
assert.match(debugging, /observable failure.*smallest reproduction.*causal path.*root cause.*coherent fix.*targeted regression.*broader checks only when/i);
assert.match(debugging, /speculative edits/i);
assert.match(debugging, /shared root-cause fix/i);

const verification = read('skills/rel-ai-verification/SKILL.md');
assert.match(descriptionOf(verification), /after repository changes, fixes, or release work/i);
assert.match(descriptionOf(verification), /Do not use for open-ended architecture or feasibility investigation/i);
assert.match(verification, /Tests are risk controls, not a requirement to test every function, branch, query, component, or file/);
assert.match(verification, /inspect existing coverage/i);
assert.match(verification, /extend, consolidate, or replace/i);
assert.match(verification, /distinct meaningful concern/i);
assert.match(verification, /local UI.*state\/runtime.*protocol\/API.*packaging\/platform\/release/i);
assert.match(verification, /Do not complete.*work session independently/i);

const processSkill = read('skills/rel-ai-dev-process/SKILL.md');
assert.match(descriptionOf(processSkill), /must stay alive across later steps/i);
assert.match(descriptionOf(processSkill), /Do not use for one-shot tests, builds, linters, migrations, checks, diagnostics, or release gates/i);
assert.match(processSkill, /Do not trigger for tests, builds, linters, source checks, release gates/);
assert.match(processSkill, /metadataRevision/);
assert.match(processSkill, /explicit `kind`/);
assert.match(processSkill, /start with explicit purpose.*determine readiness.*inspect incremental output.*interact only if required.*reuse process.*stop when no longer needed/i);
assert.match(processSkill, /return control to.*debugging.*verification/i);

const prompts = JSON.parse(read('test/fixtures/skill-behavior-prompts.json'));
const knownSkills = new Set(expected);
assert.ok(prompts.length >= 10);
assert.ok(prompts.some(item => item.skills.length === 0), 'prompt suite needs negative cases');
assert.ok(prompts.some(item => item.skills.includes('rel-ai-investigation')));
assert.ok(prompts.some(item => item.skills.includes('rel-ai-debugging')));
assert.ok(prompts.some(item => item.skills.includes('rel-ai-verification')));
assert.ok(prompts.some(item => item.skills.includes('rel-ai-planning')));
assert.ok(prompts.some(item => item.skills.includes('rel-ai-dev-process')));
assert.ok(prompts.some(item => /Run npm test/i.test(item.prompt) && item.forbiddenTool === 'relai_process'), 'one-shot command needs a managed-process counterexample');
assert.ok(prompts.some(item => /typo/i.test(item.prompt) && item.skills.length === 1), 'small localized change needs a planning counterexample');
for (const item of prompts) {
  assert.equal(new Set(item.skills).size, item.skills.length, `duplicate skill in ${item.prompt}`);
  for (const skill of item.skills) assert.ok(knownSkills.has(skill), `unknown skill ${skill} in ${item.prompt}`);
  if (item.skills.length) {
    assert.equal(item.skills[0], 'rel-ai-workflow');
    assert.equal(item.firstTool, 'relai_work');
  } else {
    assert.equal(item.firstTool, null);
  }
}

console.log('Modular skill package, routing boundaries, negative triggers, and prompt contracts passed.');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8').replaceAll('\r\n', '\n');
}

function descriptionOf(source) {
  const description = source.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  assert.ok(description, 'SKILL.md requires a frontmatter description');
  return description;
}
