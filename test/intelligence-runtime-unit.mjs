import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { relaiSemanticSearch } from "../src/bridge/semanticSearch.js";
import { relaiDiagnosticsRun } from "../src/bridge/diagnosticsRunner.js";
import { relaiCodeInspect } from "../src/bridge/codeIntelligence.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-intelligence-'));
const stateDir = path.join(root, 'state');
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.mkdirSync(path.join(root, 'test'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'attendanceService.js'), `
function calculateDailyAttendance(timeIn, shiftStart) {
  return { lateMinutes: Math.max(0, timeIn - shiftStart), present: true };
}
module.exports = { calculateDailyAttendance };
`);
fs.writeFileSync(path.join(root, 'src', 'theme.js'), `module.exports = { accent: 'blue' };\n`);
fs.writeFileSync(path.join(root, 'test', 'attendance.test.js'), `
const { calculateDailyAttendance } = require('../src/attendanceService');
calculateDailyAttendance(9, 8);
`);
const workspace = { alias: 'app', path: root, testCommands: {}, commands: {} };
const config = { stateDir };

try {
  const semantic = relaiSemanticSearch(workspace, config, { query: 'calculate employee lateness attendance', maxResults: 5 });
  assert.equal(semantic.ok, true);
  assert.equal(semantic.privacy.includes('No source text'), true);
  assert.equal(semantic.results[0].path, 'src/attendanceService.js');

  const trace = await relaiCodeInspect(workspace, config, { action: 'trace', symbol: 'calculateDailyAttendance', maxResults: 50 });
  assert.equal(trace.definitions[0].path, 'src/attendanceService.js');
  assert.ok(trace.affectedTests.includes('test/attendance.test.js'));
  assert.ok(trace.recommendedReadOrder.includes('src/attendanceService.js'));

  const diagnosticText = 'src/app.ts(4,7): error TS2345: Argument is invalid';
  fs.writeFileSync(path.join(root, 'typescript-diagnostic.cjs'), `process.stderr.write(${JSON.stringify(diagnosticText + '\n')});process.exit(1);\n`);
  const diagnostics = await relaiDiagnosticsRun(workspace, config, { command: 'node typescript-diagnostic.cjs', stopOnFailure: true });
  assert.equal(diagnostics.ok, false);
  assert.equal(diagnostics.diagnostics.length, 1);
  assert.deepEqual(diagnostics.diagnostics[0], {
    path: 'src/app.ts', line: 4, column: 7, severity: 'error', code: 'TS2345',
    message: 'Argument is invalid', source: 'typescript'
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Semantic search, relationship trace, and normalized diagnostics tests passed.');
