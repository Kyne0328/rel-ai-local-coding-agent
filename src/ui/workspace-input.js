const WORKSPACE_ALIAS_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export function deriveWorkspaceAlias(workspacePath) {
  const leaf = trimTrailingPathSeparators(workspacePath).split(/[\\/]/).filter(Boolean).at(-1) || '';
  return leaf
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function isValidWorkspaceAlias(alias) {
  return WORKSPACE_ALIAS_PATTERN.test(String(alias || '').trim());
}

export function normalizeWorkspacePath(value) {
  const normalized = trimTrailingPathSeparators(value).replace(/\\/g, '/');
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized;
}

function trimTrailingPathSeparators(value) {
  return String(value || '').trim().replace(/[\\/]+$/, '');
}
