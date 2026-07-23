import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classifyCaution } = require('../src/cautionZone.js');

for (const toolName of ['relai_write', 'relai_replace', 'relai_edit']) {
  const configFile = classifyCaution(toolName, { path: 'package.json' });
  assert.equal(configFile.level, 'caution');
  assert.equal(configFile.reason, 'workspace config path modified');

  const ignoreFile = classifyCaution(toolName, { path: '.relaiignore' });
  assert.equal(ignoreFile.level, 'caution');

  const workflowFile = classifyCaution(toolName, { path: String.raw`.github\workflows\ci.yml` });
  assert.equal(workflowFile.level, 'caution');

  const normalFile = classifyCaution(toolName, { path: 'src/example.js' });
  assert.equal(normalFile.level, null);
}

assert.equal(classifyCaution('relai_read', { paths: ['package.json'] }).level, null);
assert.equal(classifyCaution('relai_run_checks', {}).level, null);
assert.equal(classifyCaution('relai_exec', { command: 'npm install' }).level, null);
assert.equal(classifyCaution('relai_exec', { command: 'git reset --hard HEAD~1' }).level, 'caution');
assert.equal(classifyCaution('relai_exec', { command: 'docker system prune -f' }).level, 'caution');
assert.equal(classifyCaution('removed_tool', { path: 'package.json' }).level, null);

console.log('Caution-zone unit tests passed for active edit tools.');
