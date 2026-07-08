import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-local-compat-'));
const configPath = path.join(tmp, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({
  version: 1,
  stateDir: path.join(tmp, 'state'),
  toolMode: 'chatgpt_local_repo',
  trustedLocalAgent: true,
  workspaces: {
    repo: {
      path: root
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

function waitFor(id, timeoutMs = 5000) {
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
        reject(new Error(`Timed out waiting for response id ${id}.`));
      }
    }, 25);
  });
}

try {
  send(1, 'initialize');
  await waitFor(1);

  send(2, 'tools/list');
  const list = await waitFor(2);
  const names = list.result.tools.map((tool) => tool.name);
  if (names.length !== 18) throw new Error(`Expected 18 visible bridge tools, got ${names.length}`);
  for (const required of ['relai_edit', 'relai_apply_bundle', 'relai_package_snapshot', 'relai_status', 'relai_git_status', 'relai_git_commit', 'relai_write', 'relai_replace', 'relai_tidy_plan', 'relai_tidy_run']) {
    if (!names.includes(required)) throw new Error(`missing public tool ${required}`);
  }
  // These tools moved off the public connector surface (still callable on stdio).
  for (const hidden of ['relai_apply_update', 'relai_feature_probe', 'relai_refactor_audit', 'relai_remove_file', 'relai_git_fetch']) {
    if (names.includes(hidden)) throw new Error(`tool ${hidden} should be hidden from the public surface`);
  }

  send(3, 'tools/call', { name: 'relai_write', arguments: { workspace: 'repo', path: 'tmp-relai-bridge.txt', content: 'bridge write ok\n' } });
  const write = await waitFor(3);
  if (write.result.isError) throw new Error(`relai_write should be callable in local repo mode: ${write.result.content[0].text}`);

  send(31, 'tools/call', { name: 'relai_write', arguments: { workspace: 'repo', edits: [{ path: 'tmp-relai-bridge.txt', find: 'x', replace: 'y' }] } });
  const editWrite = await waitFor(31);
  if (!editWrite.result.isError) throw new Error('relai_write must reject edit-array payloads');



  fs.writeFileSync(path.join(root, 'tmp-relai-replace.txt'), 'alpha\nbeta\n');
  send(32, 'tools/call', { name: 'relai_replace', arguments: { workspace: 'repo', path: 'tmp-relai-replace.txt', oldText: 'beta\n', newText: 'gamma\n' } });
  const replace = await waitFor(32);
  if (replace.result.isError) throw new Error(`relai_replace should be callable: ${replace.result.content[0].text}`);
  if (fs.readFileSync(path.join(root, 'tmp-relai-replace.txt'), 'utf8') !== 'alpha\ngamma\n') throw new Error('relai_replace did not apply exact replacement');

  send(33, 'tools/call', { name: 'relai_clear_files', arguments: { workspace: 'repo', path: 'tmp-relai-replace.txt' } });
  const del = await waitFor(33);
  if (!del.result.isError) throw new Error(`relai_clear_files should be callable: ${del.result.content[0].text}`);

  send(4, 'tools/call', { name: 'relai_shell', arguments: { workspace: 'repo', command: 'node --version' } });
  const shell = await waitFor(4);
  if (!shell.result.isError) throw new Error('removed relai_shell should be rejected');
  if (!/Unknown tool/.test(shell.result.content[0].text)) throw new Error('removed tool should return Unknown tool');

  // relai_apply_update moved off the public surface; relai_edit covers patches now.
  send(5, 'tools/call', { name: 'relai_edit', arguments: { workspace: 'repo', updateText: 'bad patch' } });
  const patch = await waitFor(5);
  if (!patch.result.isError) throw new Error('relai_edit should reject malformed update text');


  send(6, 'tools/call', { name: 'relai_read_files', arguments: { workspace: 'repo', paths: ['package.json'] } });
  const readFiles = await waitFor(6);
  if (!readFiles.result.isError) throw new Error('removed relai_read_files should be rejected');
  if (!/Unknown tool/.test(readFiles.result.content[0].text)) throw new Error('removed read_files tool should return Unknown tool');

  send(7, 'tools/call', { name: 'relai_version', arguments: {} });
  const version = await waitFor(7);
  if (!version.result.isError) throw new Error('removed relai_version MCP tool should be rejected; use /health instead');
  if (!/Unknown tool/.test(version.result.content[0].text)) throw new Error('removed version tool should return Unknown tool');

  // Test stale tool: relai_verify → relai_run_checks
  send(10, 'tools/call', { name: 'relai_verify', arguments: {} });
  const staleVerify = await waitFor(10);
  if (!staleVerify.result.isError) throw new Error('relai_verify should be a stale-tool error');
  if (!/relai_run_checks/.test(staleVerify.result.content[0].text)) throw new Error('relai_verify error should mention relai_run_checks');

  // Test stale tool: relai_reset → relai_restore_changes
  send(11, 'tools/call', { name: 'relai_reset', arguments: {} });
  const staleReset = await waitFor(11);
  if (!staleReset.result.isError) throw new Error('relai_reset should be a stale-tool error');
  if (!/relai_restore_changes/.test(staleReset.result.content[0].text)) throw new Error('relai_reset error should mention relai_restore_changes');

  // Test stale tool: relai_delete → relai_clear_files
  send(12, 'tools/call', { name: 'relai_delete', arguments: {} });
  const staleDelete = await waitFor(12);
  if (!staleDelete.result.isError) throw new Error('relai_delete should be a stale-tool error');
  if (!/relai_clear_files/.test(staleDelete.result.content[0].text)) throw new Error('relai_delete error should mention relai_clear_files');

  // Test stale tool: relai_apply_patch → relai_apply_update
  send(13, 'tools/call', { name: 'relai_apply_patch', arguments: {} });
  const stalePatch = await waitFor(13);
  if (!stalePatch.result.isError) throw new Error('relai_apply_patch should be a stale-tool error');
  if (!/relai_apply_update/.test(stalePatch.result.content[0].text)) throw new Error('relai_apply_patch error should mention relai_apply_update');

  // Test stale tool: relai_apply_archive → relai_apply_bundle
  send(14, 'tools/call', { name: 'relai_apply_archive', arguments: {} });
  const staleArchive = await waitFor(14);
  if (!staleArchive.result.isError) throw new Error('relai_apply_archive should be a stale-tool error');
  if (!/relai_apply_bundle/.test(staleArchive.result.content[0].text)) throw new Error('relai_apply_archive error should mention relai_apply_bundle');

  // Test stale tool: relai_snapshot_archive → relai_package_snapshot
  send(15, 'tools/call', { name: 'relai_snapshot_archive', arguments: {} });
  const staleSnapshot = await waitFor(15);
  if (!staleSnapshot.result.isError) throw new Error('relai_snapshot_archive should be a stale-tool error');
  if (!/relai_package_snapshot/.test(staleSnapshot.result.content[0].text)) throw new Error('relai_snapshot_archive error should mention relai_package_snapshot');

  // relai_status toolGroups: internal-only tools must NOT leak into a public group
  // (relai_session_summary previously appeared under both audit and internal).
  send(16, 'tools/call', { name: 'relai_status', arguments: { workspace: 'repo' } });
  const statusRes = await waitFor(16);
  const statusPayload = JSON.parse(statusRes.result.content[0].text);
  if (!statusPayload.toolGroups) throw new Error('relai_status should return toolGroups');
  if (statusPayload.toolGroups.audit.includes('relai_session_summary')) {
    throw new Error('relai_session_summary is internal and must not appear in toolGroups.audit');
  }
  if (!statusPayload.toolGroups.internal.includes('relai_session_summary')) {
    throw new Error('relai_session_summary should appear under toolGroups.internal');
  }

  fs.rmSync(path.join(root, 'tmp-relai-bridge.txt'), { force: true });
  fs.rmSync(path.join(root, 'tmp-relai-replace.txt'), { force: true });

  console.log('ChatGPT local single-workflow smoke test passed; removed tools are rejected and stale tools return helpful errors.');
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
  await once(child, 'close').catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}
