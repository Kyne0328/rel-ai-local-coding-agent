import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveWorkspace } from './config.js';
import { runProcess } from './process.js';
import { gitStatusArgs, parseGitStatus } from './repo/gitStatus.js';
import { collectOptionsFromWorkspace, collectTextFiles, createCollectionPathFilter, isSecretPath, looksBinary, resolveSafePath, writeTextFileSafe } from './safety.js';
import { readTaskHistorySessionRecord } from './taskHistoryStore.js';
import { recordTaskIntegrityEvent, taskOwnedChangedFiles } from './taskIntegrity.js';
import { OPERATION_IDS as OP } from './tools/operationIds.js';

const MAX_EDITOR_FILE_BYTES = 2 * 1024 * 1024;
const MAX_EDITOR_FILES = 5000;
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;
const TERMINAL_TASK_STATES = new Set(['completed', 'cancelled', 'failed']);

async function describeTaskCodeWorkspace(config, payload = {}) {
  const context = resolveTaskCodeContext(config, payload.taskId);
  const repository = await listRepositoryFiles(config, context);
  return {
    ok: true,
    work_id: context.taskId,
    workspace: context.baseWorkspace.alias,
    workspaceMode: 'visible',
    integrationStatus: 'not_applicable',
    status: String(context.session.status || ''),
    writable: context.writable,
    files: repository.files,
    changedFiles: repository.changedFiles,
    changedFileStatuses: repository.changedFileStatuses,
    fileCount: repository.files.length,
    truncated: repository.truncated
  };
}

async function readTaskCodeFile(config, payload = {}) {
  const context = resolveTaskCodeContext(config, payload.taskId);
  const file = await readTextFile(context.executionPath, payload.path);
  return {
    ok: true,
    work_id: context.taskId,
    workspace: context.baseWorkspace.alias,
    path: file.path,
    content: file.content,
    sha256: file.sha256,
    bytes: file.bytes,
    writable: context.writable,
    language: editorLanguage(file.path)
  };
}

async function readTaskCodeDiff(config, payload = {}) {
  const context = resolveTaskCodeContext(config, payload.taskId);
  const current = await readOptionalTextFile(context.executionPath, payload.path);
  const original = await readBaseFile(config, context, current.path);
  if (!current.exists && !original.exists) throw new Error(`Code editor file is not available in the task or its Git baseline: ${current.path}`);
  return {
    ok: true,
    work_id: context.taskId,
    workspace: context.baseWorkspace.alias,
    path: current.path,
    content: current.content,
    sha256: current.sha256,
    exists: current.exists,
    baseContent: original.available === false ? current.content : original.content,
    baseExists: original.exists,
    baseAvailable: original.available !== false,
    language: editorLanguage(current.path),
    writable: context.writable && current.exists
  };
}

async function writeTaskCodeFile(config, payload = {}) {
  const context = resolveTaskCodeContext(config, payload.taskId);
  if (!context.writable) {
    const error = new Error('This task is complete or closed. The embedded editor is read-only for this task.');
    error.code = 'TASK_CODE_READ_ONLY';
    throw error;
  }
  if (typeof payload.content !== 'string') throw new Error('Code editor content must be a string.');
  if (Buffer.byteLength(payload.content, 'utf8') > MAX_EDITOR_FILE_BYTES) {
    throw new Error(`Code editor files cannot exceed ${MAX_EDITOR_FILE_BYTES} bytes.`);
  }
  const safe = resolveSafePath(context.executionPath, payload.path, {
    operation: 'write',
    proposedContent: payload.content,
    label: 'Code editor path'
  });
  const current = await fs.promises.readFile(safe.absolutePath);
  if (looksBinary(current)) throw new Error(`Code editor refuses binary-looking files: ${safe.relativePath}`);
  const currentText = current.toString('utf8');
  const currentSha256 = sha256(current);
  const expectedSha256 = String(payload.expectedSha256 || '').trim();
  if (expectedSha256 && currentSha256 !== expectedSha256) {
    const error = new Error(`The file changed after the editor opened it: ${safe.relativePath}. Reload the file before saving.`);
    error.code = 'TASK_CODE_STALE_FILE';
    error.currentSha256 = currentSha256;
    throw error;
  }
  if (currentText === payload.content) {
    return {
      ok: true,
      work_id: context.taskId,
      workspace: context.baseWorkspace.alias,
      path: safe.relativePath,
      changed: false,
      sha256: currentSha256,
      bytes: current.length
    };
  }

  const written = writeTextFileSafe(context.executionPath, safe.relativePath, payload.content, {
    expectedSha256: expectedSha256 || currentSha256
  });
  await recordTaskIntegrityEvent(config, {
    taskId: context.taskId,
    workspace: context.baseWorkspace.alias,
    taskIdentityVersion: 2,
    tool: OP.EDIT,
    ok: true,
    changedFiles: [safe.relativePath],
    ts: new Date().toISOString()
  });
  return {
    ok: true,
    work_id: context.taskId,
    workspace: context.baseWorkspace.alias,
    path: safe.relativePath,
    changed: true,
    sha256: written.sha256,
    bytes: written.bytes
  };
}

function resolveTaskCodeWorkspacePath(config, taskId) {
  return resolveTaskCodeContext(config, taskId).executionPath;
}

function resolveTaskCodeContext(config, taskIdValue) {
  const taskId = String(taskIdValue || '').trim();
  if (!taskId) throw new Error('A task ID is required for the code workspace.');
  const session = readTaskHistorySessionRecord(config, taskId, { reconcileInactive: false });
  if (!session) {
    const error = new Error('The selected Rel.AI task no longer exists.');
    error.code = 'TASK_NOT_FOUND';
    throw error;
  }
  const baseWorkspace = resolveWorkspace(config, session.workspace);
  return {
    taskId,
    session,
    baseWorkspace,
    executionPath: baseWorkspace.path,
    writable: !TERMINAL_TASK_STATES.has(String(session.status || '').toLowerCase())
  };
}

async function listRepositoryFiles(config, context) {
  const tracked = await runProcess('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: context.executionPath,
    timeout: GIT_TIMEOUT_MS,
    maxOutputBytes: MAX_GIT_OUTPUT_BYTES,
    preserveOutputWhitespace: true
  }, config).catch(() => null);
  let files;
  let truncated = false;
  if (tracked?.exitCode === 0 && !tracked.stdoutTruncated) {
    const acceptsPath = createCollectionPathFilter(
      context.executionPath,
      collectOptionsFromWorkspace(context.baseWorkspace)
    );
    files = String(tracked.stdout || '')
      .split('\0')
      .map(normalizePath)
      .filter(file => file && !isSecretPath(file) && acceptsPath(file));
    files = [...new Set(files)].sort((left, right) => left.localeCompare(right));
    if (files.length > MAX_EDITOR_FILES) {
      files = files.slice(0, MAX_EDITOR_FILES);
      truncated = true;
    }
  } else {
    const tree = collectTextFiles(context.executionPath, collectOptionsFromWorkspace(context.baseWorkspace, {
      maxEntries: MAX_EDITOR_FILES
    }));
    files = tree.files;
    truncated = tree.truncated;
  }

  const repositoryChanges = await repositoryChangedEntries(config, context.executionPath);
  const ownedChanges = new Set(
    taskOwnedChangedFiles(config, context.taskId, context.baseWorkspace.alias)
      .map(normalizePath)
      .filter(Boolean)
  );
  const changedEntries = repositoryChanges.filter(entry => ownedChanges.has(entry.path));
  const changedFiles = changedEntries.map(entry => entry.path);
  const changedFileStatuses = Object.fromEntries(
    changedEntries.map(entry => [entry.path, codeWorkspaceFileStatus(entry)])
  );
  return { files, changedFiles, changedFileStatuses, truncated };
}

async function repositoryChangedEntries(config, cwd) {
  const status = await runProcess('git', gitStatusArgs(), {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxOutputBytes: MAX_GIT_OUTPUT_BYTES,
    preserveOutputWhitespace: true
  }, config).catch(() => null);
  if (!status || status.exitCode !== 0 || status.stdoutTruncated) return [];
  const parsed = parseGitStatus(status.stdout || '');
  const entries = (parsed.entries || []).map(entry => ({
    path: normalizePath(entry.path),
    indexStatus: String(entry.indexStatus || ' '),
    worktreeStatus: String(entry.worktreeStatus || ' '),
    untracked: entry.untracked === true,
    ...(entry.originalPath ? { originalPath: normalizePath(entry.originalPath) } : {})
  })).filter(entry => entry.path);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function codeWorkspaceFileStatus(entry = {}) {
  const indexStatus = String(entry.indexStatus || ' ');
  const worktreeStatus = String(entry.worktreeStatus || ' ');
  const pair = `${indexStatus}${worktreeStatus}`;
  if (entry.untracked === true || pair === '??') return { code: 'U', label: 'Untracked', tone: 'info', indexStatus, worktreeStatus };
  if (new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']).has(pair) || indexStatus === 'U' || worktreeStatus === 'U') {
    return { code: '!', label: 'Conflict', tone: 'danger', indexStatus, worktreeStatus };
  }
  const states = [
    ['R', 'Renamed', 'info'],
    ['C', 'Copied', 'info'],
    ['A', 'Added', 'success'],
    ['D', 'Deleted', 'danger'],
    ['M', 'Modified', 'warning'],
    ['T', 'Type changed', 'warning']
  ];
  for (const [code, label, tone] of states) {
    if (indexStatus === code || worktreeStatus === code) return { code, label, tone, indexStatus, worktreeStatus };
  }
  return { code: 'M', label: 'Modified', tone: 'warning', indexStatus, worktreeStatus };
}

async function readTextFile(root, requestedPath) {
  const file = await readOptionalTextFile(root, requestedPath);
  if (!file.exists) throw new Error(`Code editor file does not exist: ${file.path}`);
  return file;
}

async function readOptionalTextFile(root, requestedPath) {
  const safe = resolveSafePath(root, requestedPath, { operation: 'read', label: 'Code editor path' });
  let stat;
  try {
    stat = await fs.promises.stat(safe.absolutePath);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return { path: safe.relativePath, content: '', sha256: '', bytes: 0, exists: false };
    }
    throw error;
  }
  if (!stat.isFile()) throw new Error(`Code editor path is not a file: ${safe.relativePath}`);
  if (stat.size > MAX_EDITOR_FILE_BYTES) throw new Error(`Code editor file exceeds ${MAX_EDITOR_FILE_BYTES} bytes: ${safe.relativePath}`);
  const data = await fs.promises.readFile(safe.absolutePath);
  if (looksBinary(data)) throw new Error(`Code editor refuses binary-looking files: ${safe.relativePath}`);
  return {
    path: safe.relativePath,
    content: data.toString('utf8'),
    sha256: sha256(data),
    bytes: data.length,
    exists: true
  };
}

async function readBaseFile(config, context, relativePath) {
  const head = await runProcess('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: context.executionPath,
    timeout: GIT_TIMEOUT_MS,
    maxOutputBytes: 1024
  }, config).catch(() => null);
  const baseCommit = head?.exitCode === 0 && !head.stdoutTruncated ? String(head.stdout || '').trim() : '';
  if (!baseCommit) return { available: false, exists: false, content: '' };
  const result = await runProcess('git', ['show', '--no-textconv', `${baseCommit}:${relativePath}`], {
    cwd: context.executionPath,
    timeout: GIT_TIMEOUT_MS,
    maxOutputBytes: MAX_EDITOR_FILE_BYTES,
    preserveOutputWhitespace: true
  }, config).catch(() => null);
  if (!result || result.stdoutTruncated) return { available: false, exists: false, content: '' };
  if (result.exitCode !== 0) return { available: true, exists: false, content: '' };
  return { available: true, exists: true, content: String(result.stdout || '') };
}

function editorLanguage(filePath) {
  const name = path.basename(String(filePath || '')).toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  const extension = path.extname(name).toLowerCase();
  return ({
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript', '.json': 'json', '.css': 'css', '.scss': 'scss',
    '.html': 'html', '.md': 'markdown', '.py': 'python', '.go': 'go', '.rs': 'rust',
    '.java': 'java', '.kt': 'kotlin', '.cs': 'csharp', '.cpp': 'cpp', '.c': 'c', '.h': 'cpp',
    '.sh': 'shell', '.ps1': 'powershell', '.sql': 'sql', '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml'
  })[extension] || 'plaintext';
}

function normalizePath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export {
  MAX_EDITOR_FILE_BYTES,
  describeTaskCodeWorkspace,
  readTaskCodeDiff,
  readTaskCodeFile,
  resolveTaskCodeWorkspacePath,
  writeTaskCodeFile
};
