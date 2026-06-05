import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-oneclick-'));
const configPath = path.join(stateDir, 'config.json');

function run(args) {
  return spawnSync(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-launch.js'), '--print-only', '--show-token', '--reset-token', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      REL_AI_MCP_STATE_DIR: stateDir,
      REL_AI_MCP_CONFIG: configPath,
      REL_AI_MCP_TOKEN: '',
      REL_AI_MCP_PUBLIC_URL: '',
      REL_AI_MCP_TUNNEL: ''
    }
  });
}

for (const args of [
  ['--public'],
  ['--public', 'ngrok'],
  ['--public', 'cloudflare'],
  ['--ngrok'],
  ['--cloudflare'],
  ['--localtunnel'],
  ['--tunnel', 'localtunnel']
]) {
  const result = run(args);
  assert.equal(result.status, 0, `${args.join(' ')} failed\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.match(result.stderr, /Rel\.AI MCP is ready\./);
}

fs.writeFileSync(
  path.join(stateDir, 'connection.json'),
  JSON.stringify({
    host: '127.0.0.1',
    port: 39876,
    publicUrl: 'https://saved.example.test'
  }, null, 2)
);

const staleProfileResult = run([]);
assert.equal(staleProfileResult.status, 0, `stale profile run failed\nstdout=${staleProfileResult.stdout}\nstderr=${staleProfileResult.stderr}`);
assert.match(staleProfileResult.stderr, /Local dashboard:\s+http:\/\/127\.0\.0\.1:3333\/dashboard/);
assert.doesNotMatch(staleProfileResult.stderr, /127\.0\.0\.1:39876/);
assert.match(staleProfileResult.stderr, /routing https:\/\/saved\.example\.test to http:\/\/127\.0\.0\.1:3333/);

const explicitPortResult = run(['--port', '4444']);
assert.equal(explicitPortResult.status, 0, `explicit port run failed\nstdout=${explicitPortResult.stdout}\nstderr=${explicitPortResult.stderr}`);
assert.match(explicitPortResult.stderr, /Local dashboard:\s+http:\/\/127\.0\.0\.1:4444\/dashboard/);
assert.match(explicitPortResult.stderr, /routing https:\/\/saved\.example\.test to http:\/\/127\.0\.0\.1:4444/);

console.log('One-click argument smoke passed.');
