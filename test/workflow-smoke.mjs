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
fs.mkdirSync(path.join(workspace, 'lib'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'README.md'), '# Smoke\n');
fs.writeFileSync(path.join(workspace, '.gitattributes'), '* text=auto eol=lf\n', 'utf8');
fs.writeFileSync(path.join(workspace, 'src', 'index.js'), 'console.log("smoke")\n');
const riskyDart = ['class SmsHandlerUtils {'];
for (let i = 0; i < 220; i += 1) riskyDart.push(`  String render${i}(String phone) => 'sms-${i}-${'$'}{phone}';`);
riskyDart.push('}');
fs.writeFileSync(path.join(workspace, 'lib', 'sms_handler_utils.dart'), `${riskyDart.join('\n')}\n`);
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
  workflow: { mode: 'aggressive', aggressive: { requireCleanGit: true, backup: true, deleteMissingDefault: false } },
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
  'relai_apply_bundle',
  'relai_apply_update',
  'relai_browser',
  'relai_clear_files',
  'relai_diff',
  'relai_feature_probe',
  'relai_read',
  'relai_replace',
  'relai_repo_snapshot',
  'relai_restore_changes',
  'relai_package_snapshot',
  'relai_run_checks',
  'relai_status',
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
if (snapshot.writeGuidance.defaultMode !== 'size-based') {
  throw new Error('snapshot should expose size-based write guidance');
}
for (const mode of ['exact-replace', 'direct-write', 'staged-write', 'apply-update', 'apply-bundle', 'clear-file']) {
  if (!snapshot.writeGuidance.modes || !snapshot.writeGuidance.modes[mode]) {
    throw new Error(`snapshot write guidance missing mode ${mode}`);
  }
}

call(4, 'relai_read', { workspace: 'smoke', paths: ['README.md'] });
const read = contentOf(await waitFor(4));
if (!read.items[0].content.includes('# Smoke')) {
  throw new Error('read failed');
}
if (read.items[0].writeGuidance.recommendedMode !== 'direct-write') {
  throw new Error('small README should recommend direct-write for complete replacement');
}
if (read.items[0].writeGuidance.localizedEdit.recommendedMode !== 'exact-replace') {
  throw new Error('small README should still recommend exact-replace for localized edits');
}

call(41, 'relai_read', { workspace: 'smoke', paths: ['lib/sms_handler_utils.dart'] });
const riskyRead = contentOf(await waitFor(41));
if (riskyRead.items[0].writeGuidance.recommendedMode !== 'exact-replace') {
  throw new Error('large interpolation-heavy source should recommend exact replacements');
}
if (!riskyRead.items[0].writeGuidance.reasons.some((item) => item.includes('template/interpolation'))) {
  throw new Error('write guidance should explain interpolation-heavy shape');
}
if (riskyRead.items[0].writeGuidance.fallbackMode !== 'staged-write') {
  throw new Error('large interpolation-heavy source should use staged-write for whole-file fallback');
}
if (riskyRead.items[0].writeGuidance.multiFileChange.recommendedMode !== 'apply-update') {
  throw new Error('large source guidance should include apply-update as the patch-shaped alternative');
}

call(42, 'relai_write', { workspace: 'smoke', path: 'lib/sms_handler_utils.dart', content: riskyRead.items[0].content });
const directWrite = contentOf(await waitFor(42));
if (!directWrite.ok) {
  throw new Error('direct full-file write should be allowed');
}

const riskySha = riskyRead.items[0].sha256;
const oldDartLine = "  String render7(String phone) => 'sms-7-${phone}';";
const newDartLine = "  String render7(String phone) => 'sms-7-fixed-' + phone;";
call(43, 'relai_replace', { workspace: 'smoke', path: 'lib/sms_handler_utils.dart', expectedSha256: riskySha, oldText: oldDartLine, newText: newDartLine });
const replacedRisky = contentOf(await waitFor(43));
if (!replacedRisky.changedFiles.includes('lib/sms_handler_utils.dart') || !replacedRisky.verified) {
  throw new Error('relai_replace should safely edit the risky interpolation-heavy Dart file');
}

call(44, 'relai_read', { workspace: 'smoke', paths: ['lib/sms_handler_utils.dart'] });
const postReplaceRead = contentOf(await waitFor(44));
if (!postReplaceRead.items[0].content.includes(newDartLine)) {
  throw new Error('relai_replace result was not visible through relai_read');
}

call(45, 'relai_replace', { workspace: 'smoke', path: 'lib/sms_handler_utils.dart', expectedSha256: riskySha, oldText: newDartLine, newText: oldDartLine });
const staleReplace = contentOf(await waitFor(45));
if (!staleReplace.shaMismatch || !staleReplace.changedFiles.includes('lib/sms_handler_utils.dart')) {
  throw new Error('relai_replace should report sha mismatch and continue');
}

fs.writeFileSync(path.join(workspace, 'docs-to-delete.md'), 'obsolete\n');
execFileSync('git', ['add', 'docs-to-delete.md'], { cwd: workspace });
execFileSync('git', ['commit', '-m', 'add obsolete doc'], { cwd: workspace, stdio: 'ignore' });
call(46, 'relai_clear_files', { workspace: 'smoke', path: 'docs-to-delete.md' });
const deletedDoc = contentOf(await waitFor(46));
if (!deletedDoc.changedFiles.includes('docs-to-delete.md') || fs.existsSync(path.join(workspace, 'docs-to-delete.md'))) {
  throw new Error('relai_clear_files should remove obsolete files without shell helpers');
}

execFileSync('git', ['add', '.'], { cwd: workspace });
execFileSync('git', ['commit', '-m', 'checkpoint before aggressive patch'], { cwd: workspace, stdio: 'ignore' });
const aggressivePatch = `diff --git a/src/index.js b/src/index.js
index 4e0946d..38910e4 100644
--- a/src/index.js
+++ b/src/index.js
@@ -1 +1 @@
-console.log("smoke")
+console.log("smoke aggressive")
`;
call(47, 'relai_apply_update', { workspace: 'smoke', updateText: aggressivePatch, checks: ['node --check src/index.js'], returnDiff: true });
const appliedPatch = contentOf(await waitFor(47));
if (!appliedPatch.ok || !appliedPatch.changedFiles.includes('src/index.js')) {
  throw new Error('relai_apply_update should apply a checked patch in aggressive mode');
}
if (!fs.readFileSync(path.join(workspace, 'src', 'index.js'), 'utf8').includes('smoke aggressive')) {
  throw new Error('relai_apply_update did not modify the file');
}

const newReadme = '# Smoke\n\nUpdated by public workflow smoke.\n';

call(5, 'relai_write', { workspace: 'smoke', path: 'README.md', content: newReadme, dryRun: true });
const dryWrite = contentOf(await waitFor(5));
if (!dryWrite.dryRun || !dryWrite.changedFiles.includes('README.md')) {
  throw new Error('dry-run write failed');
}

call(6, 'relai_write', { workspace: 'smoke', path: 'README.md', content: newReadme });
const written = contentOf(await waitFor(6));
if (!written.changedFiles.includes('README.md')) {
  throw new Error('write failed');
}
if (!written.operationId || !written.result.verified) {
  throw new Error('write did not return a verified operation id');
}

const stagedContent = '# Smoke\n\nUpdated through staged full-file write.\n';
call(62, 'relai_write', { workspace: 'smoke', stage: 'start', path: 'README.md', content: stagedContent.slice(0, 12) });
const stagedStart = contentOf(await waitFor(62));
if (!stagedStart.writeId) throw new Error('staged write did not return writeId');
call(63, 'relai_write', { workspace: 'smoke', stage: 'append', writeId: stagedStart.writeId, content: stagedContent.slice(12) });
const stagedAppend = contentOf(await waitFor(63));
if (stagedAppend.chunks !== 2) throw new Error('staged append did not record second chunk');
call(64, 'relai_write', { workspace: 'smoke', stage: 'commit', writeId: stagedStart.writeId });
const stagedCommit = contentOf(await waitFor(64));
if (!stagedCommit.staged || !stagedCommit.changedFiles.includes('README.md')) {
  throw new Error('staged commit failed');
}

call(61, 'relai_repo_snapshot', { workspace: 'smoke', maxEntries: 100, includeFiles: false, journalLimit: 5 });
const postWriteSnapshot = contentOf(await waitFor(61));
if (!postWriteSnapshot.operationJournal || !postWriteSnapshot.operationJournal.recent.some((item) => item.id === written.operationId)) {
  throw new Error('post-write snapshot did not expose the operation journal');
}

call(7, 'relai_run_checks', { workspace: 'smoke', level: 'standard' });
const verify = contentOf(await waitFor(7));
if (!verify.ok) {
  throw new Error('verify failed');
}

if (!verify.commands.includes('npm run check')) {
  throw new Error(`verify did not use npm run check: ${verify.commands.join(', ')}`);
}

call(8, 'relai_diff', { workspace: 'smoke' });
const diff = contentOf(await waitFor(8));
if (!diff.diff.includes('Updated through staged full-file write')) {
  throw new Error('diff missing staged edit');
}

call(9, 'relai_restore_changes', { workspace: 'smoke', paths: ['README.md', 'lib/sms_handler_utils.dart', 'src/index.js'] });
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
