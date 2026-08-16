import assert from 'node:assert/strict';
import { getToolMetadata, getToolNames } from '../src/tools/schema.js';

const byName = new Map(getToolMetadata().map(tool => [tool.name, tool]));
const expected = new Map([
  ['relai_snapshot', ['inspect']],
  ['relai_read', ['inspect']],
  ['relai_search', ['inspect']],
  ['relai_inspect', ['inspect']],
  ['relai_edit', ['edit']],
  ['relai_exec', ['execute']],
  ['relai_process', ['execute']],
  ['relai_work', ['workflow']],
  ['relai_changes', ['review', 'recover']],
  ['relai_validate', ['validate']],
  ['relai_publish', ['git']]
]);
for (const [name, capabilities] of expected) {
  assert.deepEqual(byName.get(name)?.capabilities, capabilities, `${name} dashboard category is wrong`);
}
assert.equal(byName.size, getToolNames().length, 'dashboard metadata must cover the complete canonical tool surface');
console.log('Tool dashboard categories match the canonical public tool surface.');
