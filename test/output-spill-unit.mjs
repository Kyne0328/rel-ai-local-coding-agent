import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createOutputSpillWriter, outputSpillOwner, readOutputSpill } from '../src/outputSpill.js';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-output-spill-'));
const config = { stateDir };
const spillRoot = path.join(stateDir, 'output-spills');

try {
  const tasklessOwner = outputSpillOwner({ workspace: 'app', principal: 'principal-a' });
  assert.ok(tasklessOwner, 'authorized workspace execution must derive a taskless output owner');
  assert.equal(tasklessOwner, outputSpillOwner({ workspace: 'app', principal: 'principal-a' }));
  assert.notEqual(tasklessOwner, outputSpillOwner({ workspace: 'app', principal: 'principal-b' }), 'different principals must not share taskless output refs');
  const tasklessWriter = createOutputSpillWriter(config, tasklessOwner);
  tasklessWriter.start('taskless output');
  const tasklessResult = tasklessWriter.finish();
  const tasklessSpill = readOutputSpill(config, tasklessOwner, tasklessResult.outputRef);
  assert.equal(fs.readFileSync(tasklessSpill.file, 'utf8'), 'taskless output');
  assert.throws(
    () => readOutputSpill(config, outputSpillOwner({ workspace: 'app', principal: 'principal-b' }), tasklessResult.outputRef),
    /not found for this authorized execution scope/i
  );

  fs.mkdirSync(path.join(spillRoot, 'legacy-empty-task'), { recursive: true });

  for (let index = 0; index < 120; index += 1) {
    const writer = createOutputSpillWriter(config, `task-${index}`);
    writer.start(`spill-${index}`);
    const result = writer.finish();
    assert.ok(result?.outputRef, `spill ${index} must produce an outputRef`);
  }

  const directories = fs.readdirSync(spillRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
  const logFiles = directories.flatMap(directory => fs.readdirSync(path.join(spillRoot, directory))
    .filter(name => name.endsWith('.log')));

  assert.equal(logFiles.length, 100, 'spill pruning must enforce the 100-file retention bound');
  assert.equal(directories.length, logFiles.length, 'spill pruning must remove empty per-task directories');
  assert.equal(directories.includes('legacy-empty-task'), false, 'spill pruning must remove legacy empty task directories');
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('Output spill retention removes empty task directories while preserving bounded logs.');
