import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-oneclick-'));
const configPath = path.join(stateDir, 'config.json');

function run(args) {
  return spawnSync(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-launch.js'), '--print-only', '--show-token', '--reset-token', '--reset-chatgpt-secret', ...args], {
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

console.log('One-click argument smoke passed.');
