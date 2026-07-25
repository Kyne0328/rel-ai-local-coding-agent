'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function passedScenario(id, title, details = {}) {
  return { id, title, status: 'passed', ...details };
}

async function captureWindow(window, options = {}) {
  const directory = String(process.env.REL_AI_WINDOW_SMOKE_EVIDENCE_DIR || '').trim();
  if (!directory) return null;
  const file = String(options.file || '').trim();
  if (!file || path.basename(file) !== file) throw new Error('Smoke screenshot filename must be a plain filename.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const image = await window.webContents.capturePage();
  const buffer = image.toPNG();
  if (!buffer.length) throw new Error(`Smoke screenshot is empty: ${file}`);
  const target = path.join(directory, file);
  fs.writeFileSync(target, buffer, { mode: 0o600 });
  const size = image.getSize();
  return {
    scenarioId: options.scenarioId,
    file: path.posix.join('screenshots', file),
    width: size.width,
    height: size.height,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex')
  };
}

function writeWindowSmokeResult(result) {
  const target = String(process.env.REL_AI_WINDOW_SMOKE_RESULT || '').trim();
  if (!target) return;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function writeWindowSmokeFailure(error) {
  writeWindowSmokeResult({
    ok: false,
    error: error instanceof Error ? error.stack || error.message : String(error || 'Unknown window-smoke failure')
  });
}

module.exports = { captureWindow, passedScenario, writeWindowSmokeFailure, writeWindowSmokeResult };
