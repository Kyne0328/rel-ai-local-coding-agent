import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'knip.production.json'), 'utf8'));
const dependencyModel = fs.readFileSync(path.join(root, 'scripts', 'knip-production-runtime.mjs'), 'utf8');
const rootEntries = config.workspaces['.'].entry;
const electronEntries = config.workspaces.electron.entry;
assert.ok(rootEntries.includes('scripts/knip-production-runtime.mjs!'), 'packaged runtime dependency model must be a production entry');
assert.ok(rootEntries.includes('bin/**/*.js!'), 'CLI and stdio entry points must be modeled');
assert.ok(rootEntries.includes('src/**/*.js!'), 'packaged backend and dynamic resource imports must be modeled');
assert.ok(rootEntries.includes('public/**/*.js!'), 'packaged dashboard runtime must be modeled');
assert.ok(electronEntries.includes('*.js!'), 'Electron main and updater runtime must be modeled');
assert.ok(electronEntries.includes('renderer/**/*.js!'), 'Electron renderer runtime must be modeled');
for (const dependency of [
  '@modelcontextprotocol/node',
  '@modelcontextprotocol/server',
  '@opentelemetry/api',
  '@opentelemetry/exporter-trace-otlp-http',
  '@opentelemetry/resources',
  '@opentelemetry/sdk-trace-node',
  '@opentelemetry/semantic-conventions'
]) assert.ok(dependencyModel.includes(`'${dependency}'`), `dependency model must include ${dependency}`);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-knip-production-'));
try {
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({
    name: 'unused-production-dependency-fixture',
    private: true,
    type: 'module',
    dependencies: { 'unused-production-fixture': '1.0.0' }
  }, null, 2));
  fs.writeFileSync(path.join(fixture, 'index.js'), 'console.log("fixture");\n');
  fs.writeFileSync(path.join(fixture, 'knip.json'), JSON.stringify({
    entry: ['index.js!'],
    project: ['index.js!']
  }, null, 2));
  const cli = path.join(root, 'node_modules', 'knip', 'bin', 'knip.js');
  const result = spawnSync(process.execPath, [cli, '--directory', fixture, '--production', '--dependencies'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true
  });
  assert.notEqual(result.status, 0, 'an intentionally unused production dependency fixture must fail');
  assert.match(`${result.stdout}\n${result.stderr}`, /unused-production-fixture/);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log('Production Knip models shipped runtimes and rejects an unused production dependency fixture.');
