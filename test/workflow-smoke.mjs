import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-ai-mcp-workflow-'));
const workspace = path.join(temp, 'workspace');
const stateDir = path.join(temp, 'state');
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(workspace, 'README.md'), '# Smoke\n');
fs.writeFileSync(path.join(workspace, '.gitattributes'), '* text=auto eol=lf\n', 'utf8');
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(\\"ok\\")"' } }, null, 2));
execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'relai@example.test'], { cwd: workspace });
execFileSync('git', ['config', 'user.name', 'RelAI Smoke'], { cwd: workspace });
execFileSync('git', ['add', '.'], { cwd: workspace });
execFileSync('git', ['commit', '-m', 'init'], { cwd: workspace, stdio: 'ignore' });

const configPath = path.join(temp, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({
  version: 1,
  stateDir,
  approvalGates: { reset: false, "worktree-remove": false, push: false, pr: false },
  allowGitHubCli: false,
  workspaces: {
    smoke: {
      path: workspace,
      protectedBranches: ['main', 'master'],
      testCommands: { unit: 'npm test' },
      commands: { echo: 'node -e "console.log(\\"hello\\")"' }
    }
  }
}, null, 2));

const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp.js')], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, REL_AI_MCP_CONFIG: configPath }
});

let buffer = '';
const responses = [];
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) responses.push(JSON.parse(line));
  }
});

function send(id, method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
}
function call(id, name, args = {}) {
  send(id, 'tools/call', { name, arguments: args });
}
function waitFor(id, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = responses.find((item) => item.id === id);
      if (found) { clearInterval(timer); resolve(found); return; }
      if (Date.now() - started > timeoutMs) { clearInterval(timer); reject(new Error(`timeout ${id}`)); }
    }, 25);
  });
}

send(1, 'initialize', { protocolVersion: '2025-06-18' });
await waitFor(1);
call(2, 'relai_task_start', { workspace: 'smoke', goal: 'smoke workflow' });
const sessionResponse = await waitFor(2);
const sessionId = sessionResponse.result.structuredContent.id;
if (!sessionId) throw new Error('session id missing');
call(3, 'relai_create_branch', { workspace: 'smoke', branchName: 'relai/smoke', sessionId });
const branch = await waitFor(3);
if (!branch.result.structuredContent.ok) throw new Error('branch create failed');
call(4, 'relai_write_file', { workspace: 'smoke', path: 'src/hello.txt', content: 'hello\n' });
const write = await waitFor(4);
if (!write.result.structuredContent.ok) throw new Error('write failed');
call(5, 'relai_run_test', { workspace: 'smoke', testCommandKey: 'unit', sessionId });
const test = await waitFor(5);
if (!test.result.structuredContent.ok) throw new Error('test failed');
call(6, 'relai_task_read', { sessionId });
const read = await waitFor(6);
if ((read.result.structuredContent.steps || []).length < 2) throw new Error('session steps missing');

child.stdin.end();
child.kill('SIGTERM');
await once(child, 'close');
console.log('Workflow smoke test passed.');
