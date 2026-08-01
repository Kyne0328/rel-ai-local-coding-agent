import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['src', 'public', 'electron', 'types', 'examples', 'scripts', 'docs'];
const topLevelFiles = ['README.md', 'package.json'];
const extensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.d.ts', '.json', '.md', '.html', '.css']);
const forbidden = [
  'relai_apply_bundle',
  'relai_package_snapshot',
  'relai_apply_update',
  'relai_clear_files',
  'relai_feature_probe',
  'relai_git_fetch',
  'relai_git_merge_branch',
  'relai_git_merge_remote_branches_plan',
  'relai_git_abort_merge',
  'relai_remove_file',
  'relai_refactor_audit',
  'relai_set_policy',
  'relai_session_summary',
  'PUBLIC_HTTP_TOOL_NAMES',
  'BRIDGE_TOOL_NAMES',
  'getPublicToolDefinitions',
  'getPublicToolMetadata',
  'publicOrder',
  'publicStrip',
  'makeDefaultWorkflowConfig',
  'normalizeWorkflowConfig',
  'getWorkflowConfig',
  'isPreparedWorkflow',
  'maxBundleBytes',
  'clearMissingDefault',
  'removedLegacyWorkflows'
];

function collectFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(full));
    else if (extensions.has(path.extname(entry.name)) || entry.name.endsWith('.d.ts')) files.push(full);
  }
  return files;
}

const files = [
  ...roots.flatMap(relative => collectFiles(path.join(root, relative))),
  ...topLevelFiles.map(relative => path.join(root, relative))
];
const findings = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const identifier of forbidden) {
    if (text.includes(identifier)) findings.push(`${path.relative(root, file)} contains ${identifier}`);
  }
}

assert.deepEqual(findings, [], `Obsolete surface residue found:\n${findings.join('\n')}`);
assert.equal(fs.existsSync(path.join(root, 'src', 'bridge', 'archive.js')), false);
assert.equal(fs.existsSync(path.join(root, 'src', 'bridge', 'editCompatibility.js')), false);
assert.equal(fs.existsSync(path.join(root, 'src', 'doctor.js')), false);
assert.equal(fs.existsSync(path.join(root, 'src', 'repo', 'archiveUtils.js')), false);
assert.equal(fs.existsSync(path.join(root, 'src', 'repo', 'audit.js')), false);
assert.equal(fs.existsSync(path.join(root, 'src', 'ui', 'components', 'badge.js')), false);
assert.equal(fs.existsSync(path.join(root, 'src', 'nativeTasksProbe.js')), false);

const removedCompatibilityNames = [
  'relai_write', 'relai_replace', 'relai_browser',
  'relai_restore_changes', 'relai_git_status', 'relai_git_create_pr'
];
for (const relativePath of ['src/tools/registry.js', 'src/tools/handlers.js', 'src/localRepoBridge.js']) {
  const text = fs.readFileSync(path.join(root, relativePath), 'utf8');
  for (const name of removedCompatibilityNames) {
    assert.equal(text.includes(name), false, `${relativePath} still routes removed tool ${name}`);
  }
}

const removedTaskSurfaceNames = [
  'relai_native_tasks_probe',
  'relai_operation_task_get',
  'relai_operation_task_update',
  'relai_operation_task_cancel',
  'relai_validation_plan',
  'relai_ui_check'
];
for (const relativePath of [
  'src/mcp/transportTasks.js',
  'src/tools/operation.js',
  'src/tools/registry.js',
  'src/tools/handlers.js'
]) {
  const text = fs.readFileSync(path.join(root, relativePath), 'utf8');
  for (const name of removedTaskSurfaceNames) {
    assert.equal(text.includes(name), false, `${relativePath} still contains removed task surface ${name}`);
  }
}

console.log('Obsolete surface residue scan passed.');
