import { execSync } from "node:child_process";

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

function gitOutput(command, execOpts) {
  return execSync(command, execOpts).toString().trim();
}

function normalizeChangedFiles(...groups) {
  const all = groups.flatMap((group) => group.split('\n'))
    .map((f) => f.trim())
    .filter(Boolean);
  return [...new Set(all)];
}

function getChangedFiles(workspacePath) {
  const execOpts = { cwd: workspacePath, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] };
  try {
    return normalizeChangedFiles(
      gitOutput('git diff --name-only', execOpts),
      gitOutput('git diff --name-only --cached', execOpts),
      gitOutput('git ls-files --others --exclude-standard', execOpts)
    );
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] changed file detection:', error);
    return null;
  }
}

function classifyFiles(files, workspaceConfig) {
  if (!files || files.length === 0) return { level: 'focused', reason: 'no changed files detected' };

  const rules = workspaceConfig?.validationRules || {};
  const customMatch = customRuleMatch(files, rules);
  if (customMatch) return customMatch;
  const levelMatch = levelRuleMatch(files);
  if (levelMatch) return levelMatch;
  const multiDirMatch = multiDirRuleMatch(files, rules);
  if (multiDirMatch) return multiDirMatch;
  const singleFileMatch = singleFileRuleMatch(files);
  if (singleFileMatch) return singleFileMatch;

  return { level: 'focused', reason: `${files.length} files in one directory` };
}

function positiveRuleNumber(value, fallback) {
  return Number.isFinite(value) && value >= 1 ? value : fallback;
}

function customRuleMatch(files, rules) {
  const customRules = Array.isArray(rules.customRules) ? rules.customRules : [];
  for (const cr of customRules) {
    if (!cr || !VALID_LEVELS.has(cr.level) || typeof cr.pattern !== 'string' || !cr.pattern) continue;
    if (files.some((f) => f.includes(cr.pattern))) {
      return { level: cr.level, reason: typeof cr.reason === 'string' && cr.reason ? cr.reason : `matched custom rule ${cr.pattern}` };
    }
  }
  return null;
}

function levelRuleMatch(files) {
  for (const rule of LEVEL_RULES) {
    if (files.some(rule.test)) return { level: rule.level, reason: rule.reason };
  }
  return null;
}

function multiDirRuleMatch(files, rules) {
  const broadMultiDirThreshold = positiveRuleNumber(rules.broadMultiDirThreshold, 6);
  const broadMultiDirTopDirs = positiveRuleNumber(rules.broadMultiDirTopDirs, 2);
  const filesWithDir = files.filter((f) => f.includes('/'));
  const topDirs = new Set(filesWithDir.map((f) => f.split('/')[0]));
  if (filesWithDir.length >= broadMultiDirThreshold && topDirs.size >= broadMultiDirTopDirs) {
    return { level: 'broad', reason: `${filesWithDir.length} files across multiple directories` };
  }
  return null;
}

function singleFileRuleMatch(files) {
  if (files.length !== 1) return null;
  const f = files[0];
  if (/\.(md|txt|csv|rst)$/i.test(f)) return { level: 'minimal', reason: 'single low-risk file' };
  return { level: 'focused', reason: 'single source file' };
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

export { selectValidationLevel, classifyFiles };
