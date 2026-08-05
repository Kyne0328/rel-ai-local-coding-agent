import * as fs from 'node:fs';
import * as path from 'node:path';
import { importResourceModule } from './resource-path.js';

const { sanitizeDiagnosticValue } = await importResourceModule('src/diagnostics.js');

function createDiagnosticFiles({ app, shell, now = () => new Date() } = {}) {
  if (!app || typeof app.getPath !== 'function') throw new Error('Electron app path access is required.');
  if (!shell || typeof shell.openPath !== 'function') throw new Error('Electron shell access is required.');

  function directory() {
    return path.join(app.getPath('userData'), 'diagnostics');
  }

  function serviceLogPath() {
    return path.join(directory(), 'service.log');
  }

  async function openFolder() {
    const target = ensureDirectory();
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return { ok: true, directory: target };
  }

  async function exportReport(report) {
    const exportedAt = now();
    const sanitized = sanitizeDiagnosticValue(report || {});
    const payload = {
      schemaVersion: 1,
      exportedAt: exportedAt.toISOString(),
      report: sanitized
    };
    const text = JSON.stringify(payload, null, 2);
    if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) throw new Error('Diagnostic export exceeds the 2 MiB safety limit.');
    const targetDirectory = ensureDirectory();
    const filename = `relai-diagnostic-state-${fileTimestamp(exportedAt)}.json`;
    const target = path.join(targetDirectory, filename);
    fs.writeFileSync(target, text, { encoding: 'utf8', mode: 0o600 });
    return { ok: true, path: target, directory: targetDirectory, filename };
  }

  function ensureDirectory() {
    const target = directory();
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    return target;
  }

  return { directory, serviceLogPath, openFolder, exportReport };
}

function fileTimestamp(value) {
  return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-');
}

export { createDiagnosticFiles, fileTimestamp };
