import path from 'node:path';

import { collectOptionsFromWorkspace, collectTextFiles, resolveSafePath } from './safety.js';

const SOURCE_PREFIX = /^source:(\d+)(?:\/(.*))?$/;

function workspaceSourceEntries(workspace = {}) {
  const raw = [workspace.path, ...(Array.isArray(workspace.sourcePaths) ? workspace.sourcePaths : [])]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  const seen = new Set();
  const entries = [];
  for (const root of raw) {
    const key = sourceRootKey(root);
    if (seen.has(key)) continue;
    seen.add(key);
    const number = entries.length + 1;
    entries.push({
      number,
      root,
      primary: number === 1,
      prefix: number === 1 ? '' : `source:${number}`
    });
  }
  return entries;
}

function sourceRootKey(root) {
  const resolved = path.resolve(String(root || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sourceWorkspace(workspace, source) {
  return {
    ...workspace,
    path: source.root,
    sourcePaths: [source.root]
  };
}

function parseWorkspaceSourcePath(workspace, value) {
  const raw = String(value ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
  const entries = workspaceSourceEntries(workspace);
  if (!entries.length) throw new Error('Workspace has no configured source folder.');
  const matched = raw.match(SOURCE_PREFIX);
  if (!matched) return { source: entries[0], relativePath: raw };
  const sourceNumber = Number(matched[1]);
  const source = entries[sourceNumber - 1];
  if (!source) throw new Error(`Unknown workspace source folder ${sourceNumber}.`);
  return { source, relativePath: matched[2] || '.' };
}

function qualifyWorkspaceSourcePath(source, relativePath) {
  const clean = String(relativePath || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!clean || clean === '.') return source.primary ? '.' : source.prefix;
  return source.primary ? clean : `${source.prefix}/${clean}`;
}

function resolveWorkspaceSourcePath(workspace, value, options = {}) {
  const parsed = parseWorkspaceSourcePath(workspace, value);
  const safe = resolveSafePath(parsed.source.root, parsed.relativePath, options);
  return {
    ...safe,
    relativePath: qualifyWorkspaceSourcePath(parsed.source, safe.relativePath),
    sourceRelativePath: safe.relativePath,
    sourceRoot: parsed.source.root,
    sourceNumber: parsed.source.number,
    primarySource: parsed.source.primary
  };
}

function collectWorkspaceTextFiles(workspace, overrides = {}) {
  const entries = workspaceSourceEntries(workspace);
  const maxEntries = Number.isFinite(overrides.maxEntries) ? Math.max(0, Number(overrides.maxEntries)) : Infinity;
  const files = [];
  const skipped = [];
  let truncated = false;
  for (const source of entries) {
    const remaining = Number.isFinite(maxEntries) ? Math.max(0, maxEntries - files.length) : Infinity;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const tree = collectTextFiles(source.root, collectOptionsFromWorkspace(workspace, { ...overrides, maxEntries: remaining }));
    files.push(...tree.files.map(relativePath => qualifyWorkspaceSourcePath(source, relativePath)));
    skipped.push(...tree.skipped.map(item => ({
      ...item,
      path: qualifyWorkspaceSourcePath(source, item.path)
    })));
    if (tree.truncated) truncated = true;
  }
  return { files, skipped, truncated };
}

function sourceForWorkspacePath(workspace, value) {
  return parseWorkspaceSourcePath(workspace, value).source;
}

function stripWorkspaceSourcePrefix(workspace, value, source) {
  const parsed = parseWorkspaceSourcePath(workspace, value);
  if (parsed.source.number !== source.number) return null;
  return parsed.relativePath;
}

export {
  collectWorkspaceTextFiles,
  parseWorkspaceSourcePath,
  qualifyWorkspaceSourcePath,
  resolveWorkspaceSourcePath,
  sourceForWorkspacePath,
  sourceWorkspace,
  stripWorkspaceSourcePrefix,
  workspaceSourceEntries
};
