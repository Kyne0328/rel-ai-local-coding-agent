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
fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'README.md'), '# Smoke\n');
fs.writeFileSync(path.join(workspace, '.gitattributes'), '* text=auto eol=lf\n', 'utf8');
fs.writeFileSync(path.join(workspace, 'src', 'index.js'), 'console.log("smoke")\n');
fs.writeFileSync(
  path.join(workspace, 'package.json'),
  JSON.stringify({
    scripts: {
      check: 'node --check src/index.js',
      test: 'node -e "console.log(\\"ok\\")"'
    }
  }, null, 2)
);

execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'relai@example.test'], { cwd: workspace });
execFileSync('git', ['config', 'user.name', 'RelAI Smoke'], { cwd: workspace });
execFileSync('git', ['add', '.'], { cwd: workspace });
execFileSync('git', ['commit', '-m', 'init'], { cwd: workspace, stdio: 'ignore' });

const configPath = path.join(temp, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({
  version: 1,
  stateDir,
  workspaces: {
    smoke: {
      path: workspace,
      protectedBranches: ['main', 'master'],
      testCommands: {
        check: 'npm run check',
        unit: 'npm test'
      },
      commands: {}
    }
  }
}, null, 2));

const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp.js')], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: configPath
  }
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

function waitFor(id, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = responses.find((item) => item.id === id);
      if (found) {
        clearInterval(timer);
        resolve(found);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timeout ${id}`));
      }
    }, 25);
  });
}

function contentOf(response) {
  const payload = response.result && response.result.structuredContent;
  if (!payload || payload.ok === false) {
    throw new Error(JSON.stringify(payload || response));
  }
  return payload;
}

send(1, 'initialize', { protocolVersion: '2025-06-18' });
await waitFor(1);

send(2, 'tools/list');
const listedResponse = await waitFor(2);
const listed = listedResponse.result || {};
const names = (listed.tools || []).map((tool) => tool.name).sort();
const expected = [
  'relai_browser',
  'relai_diff',
  'relai_read',
  'relai_repo_snapshot',
  'relai_reset',
  'relai_shell',
  'relai_verify',
  'relai_write'
].sort();

if (JSON.stringify(names) !== JSON.stringify(expected)) {
  throw new Error(`unexpected public tools: ${names.join(', ')}`);
}

call(3, 'relai_repo_snapshot', { workspace: 'smoke', maxEntries: 100 });
const snapshot = contentOf(await waitFor(3));
if (!snapshot.files.includes('README.md')) {
  throw new Error('snapshot missing README.md');
}

call(4, 'relai_read', { workspace: 'smoke', paths: ['README.md'] });
const read = contentOf(await waitFor(4));
if (!read.items[0].content.includes('# Smoke')) {
  throw new Error('read failed');
}

const edit = {
  op: 'insertAfter',
  file: 'README.md',
  anchor: '# Smoke\n',
  text: '\nUpdated by public workflow smoke.\n'
};

call(5, 'relai_write', { workspace: 'smoke', edits: [edit], dryRun: true });
const dryWrite = contentOf(await waitFor(5));
if (!dryWrite.dryRun || !dryWrite.changedFiles.includes('README.md')) {
  throw new Error('dry-run write failed');
}

call(6, 'relai_write', { workspace: 'smoke', edits: [edit] });
const written = contentOf(await waitFor(6));
if (!written.changedFiles.includes('README.md')) {
  throw new Error('write failed');
}
if (!written.operationId || !written.results[0].verified) {
  throw new Error('write did not return a verified operation id');
}

call(61, 'relai_repo_snapshot', { workspace: 'smoke', maxEntries: 100, includeFiles: false, journalLimit: 5 });
const postWriteSnapshot = contentOf(await waitFor(61));
if (!postWriteSnapshot.operationJournal || !postWriteSnapshot.operationJournal.recent.some((item) => item.id === written.operationId)) {
  throw new Error('post-write snapshot did not expose the operation journal');
}

call(7, 'relai_verify', { workspace: 'smoke', level: 'standard' });
const verify = contentOf(await waitFor(7));
if (!verify.ok) {
  throw new Error('verify failed');
}

if (!verify.commands.includes('npm run check')) {
  throw new Error(`verify did not use npm run check: ${verify.commands.join(', ')}`);
}

call(8, 'relai_diff', { workspace: 'smoke' });
const diff = contentOf(await waitFor(8));
if (!diff.diff.includes('Updated by public workflow smoke')) {
  throw new Error('diff missing edit');
}

call(9, 'relai_reset', { workspace: 'smoke', paths: ['README.md'] });
const reset = contentOf(await waitFor(9));
if (!reset.ok) {
  throw new Error('reset failed');
}

call(10, 'relai_diff', { workspace: 'smoke' });
const cleanDiff = contentOf(await waitFor(10));
if (cleanDiff.diff.trim()) {
  throw new Error('diff should be clean after reset');
}

child.stdin.end();
child.kill('SIGTERM');
await once(child, 'close');

console.log('Public workflow smoke test passed.');
