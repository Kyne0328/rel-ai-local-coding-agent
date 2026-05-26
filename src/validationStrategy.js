const { execSync } = require('node:child_process');

const VALID_LEVELS = new Set(['minimal', 'focused', 'broad', 'extended']);

const LEVEL_RULES = [
  {
    level: 'extended',
    test: (f) => /\.(json|ya?ml)$/.test(f) || f.includes('.github/'),
    reason: 'config or CI file changed'
  },
  {
    level: 'broad',
    test: (f) =>
      /\/(server|http|routes|api)\b/.test(f) ||
      /\/(tools|localRepoBridge|config)\.[jt]s$/.test(f) ||
      f.includes('/ui/') ||
      /\.(html|css)$/.test(f),
    reason: 'HTTP, core operator, or UI file changed'
  }
];

function getChangedFiles(workspacePath) {
  const opts = { cwd: workspacePath, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] };
  try {
    const unstaged = execSync('git diff --name-only', opts).toString().trim();
    const staged = execSync('git diff --name-only --cached', opts).toString().trim();
    const untracked = execSync('git ls-files --others --exclude-standard', opts).toString().trim();
    const all = [...unstaged.split('\n'), ...staged.split('\n'), ...untracked.split('\n')]
      .map((f) => f.trim())
      .filter(Boolean);
    return [...new Set(all)];
  } catch (_err) {
    return null;
  }
}

function classifyFiles(files) {
  if (!files || files.length === 0) return { level: 'focused', reason: 'no changed files detected' };

  for (const rule of LEVEL_RULES) {
    if (files.some(rule.test)) return { level: rule.level, reason: rule.reason };
  }

  const topDirs = new Set(files.map((f) => f.split('/')[0]));
  if (files.length >= 6 && topDirs.size > 1) {
    return { level: 'broad', reason: `${files.length} files across multiple directories` };
  }

  if (files.length === 1) {
    const f = files[0];
    if (/\.(md|txt|csv|rst)$/i.test(f)) return { level: 'minimal', reason: 'single low-risk file' };
    return { level: 'focused', reason: 'single source file' };
  }

  return { level: 'focused', reason: `${files.length} files in one directory` };
}

function selectValidationLevel(workspacePath, _workspaceConfig, overrideLevel) {
  if (overrideLevel && VALID_LEVELS.has(overrideLevel)) {
    return { level: overrideLevel, reason: 'caller-specified', changedFiles: [] };
  }

  const changedFiles = getChangedFiles(workspacePath);
  if (changedFiles === null) {
    return { level: 'focused', reason: 'git diff unavailable', changedFiles: [] };
  }

  const { level, reason } = classifyFiles(changedFiles);
  return { level, reason, changedFiles };
}

module.exports = { selectValidationLevel };
