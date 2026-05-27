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

function classifyFiles(files, workspaceConfig) {
  if (!files || files.length === 0) return { level: 'focused', reason: 'no changed files detected' };

  const rules = (workspaceConfig && workspaceConfig.validationRules) || {};
  const broadMultiDirThreshold = Number.isFinite(rules.broadMultiDirThreshold) && rules.broadMultiDirThreshold >= 1
    ? rules.broadMultiDirThreshold : 6;
  const broadMultiDirTopDirs = Number.isFinite(rules.broadMultiDirTopDirs) && rules.broadMultiDirTopDirs >= 1
    ? rules.broadMultiDirTopDirs : 2;

  const customRules = Array.isArray(rules.customRules) ? rules.customRules : [];
  for (const cr of customRules) {
    if (!cr || !VALID_LEVELS.has(cr.level) || typeof cr.pattern !== 'string' || !cr.pattern) continue;
    if (files.some((f) => f.includes(cr.pattern))) {
      return { level: cr.level, reason: typeof cr.reason === 'string' && cr.reason ? cr.reason : `matched custom rule ${cr.pattern}` };
    }
  }

  for (const rule of LEVEL_RULES) {
    if (files.some(rule.test)) return { level: rule.level, reason: rule.reason };
  }

  const filesWithDir = files.filter((f) => f.includes('/'));
  const topDirs = new Set(filesWithDir.map((f) => f.split('/')[0]));
  if (filesWithDir.length >= broadMultiDirThreshold && topDirs.size >= broadMultiDirTopDirs) {
    return { level: 'broad', reason: `${filesWithDir.length} files across multiple directories` };
  }

  if (files.length === 1) {
    const f = files[0];
    if (/\.(md|txt|csv|rst)$/i.test(f)) return { level: 'minimal', reason: 'single low-risk file' };
    return { level: 'focused', reason: 'single source file' };
  }

  return { level: 'focused', reason: `${files.length} files in one directory` };
}

function selectValidationLevel(workspacePath, workspaceConfig, overrideLevel) {
  if (overrideLevel && VALID_LEVELS.has(overrideLevel)) {
    return { level: overrideLevel, reason: 'caller-specified', changedFiles: [] };
  }

  const changedFiles = getChangedFiles(workspacePath);
  if (changedFiles === null) {
    return { level: 'focused', reason: 'git diff unavailable', changedFiles: [] };
  }

  const { level, reason } = classifyFiles(changedFiles, workspaceConfig);
  return { level, reason, changedFiles };
}

module.exports = { selectValidationLevel, classifyFiles };
