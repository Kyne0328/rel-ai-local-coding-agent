import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePlugin } from '../scripts/validate-plugin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = ['rel-ai-debugging', 'rel-ai-dev-process', 'rel-ai-investigation', 'rel-ai-verification', 'rel-ai-workflow'];
const validation = validatePlugin(root);
assert.deepEqual(validation.skills, expected);

const workflow = read('skills/rel-ai-workflow/SKILL.md');
assert.match(workflow, /action: "begin"` exactly once/);
assert.match(workflow, /Tests, builds, linters, source checks, and release gates are one-shot commands/);
assert.match(workflow, /relai:\/\/server\/tool-surface/);

for (const name of expected.filter(name => name !== 'rel-ai-workflow')) {
  const source = read(`skills/${name}/SKILL.md`);
  assert.match(source, /Reuse the active `work_id`/);
  assert.match(source, /Do not call `relai_work` with `action: "begin"`/);
}
const processSkill = read('skills/rel-ai-dev-process/SKILL.md');
assert.match(processSkill, /Do not trigger for tests, builds, linters, source checks, release gates/);
assert.match(processSkill, /metadataRevision/);
assert.match(processSkill, /explicit `kind`/);

const prompts = JSON.parse(read('test/fixtures/skill-behavior-prompts.json'));
assert.ok(prompts.length >= 10);
assert.ok(prompts.some(item => item.skills.length === 0), 'prompt suite needs negative cases');
assert.ok(prompts.some(item => item.skills.includes('rel-ai-investigation')));
assert.ok(prompts.some(item => item.skills.includes('rel-ai-debugging')));
assert.ok(prompts.some(item => item.skills.includes('rel-ai-verification')));
assert.ok(prompts.some(item => item.skills.includes('rel-ai-dev-process')));
for (const item of prompts) {
  assert.equal(new Set(item.skills).size, item.skills.length, `duplicate skill in ${item.prompt}`);
  if (item.skills.length) {
    assert.equal(item.skills[0], 'rel-ai-workflow');
    assert.equal(item.firstTool, 'relai_work');
  }
}

console.log('Modular skill package, ownership, negative triggers, and behavioral prompt contracts passed.');

function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8').replaceAll('\r\n', '\n'); }
